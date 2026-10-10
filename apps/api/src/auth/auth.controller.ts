import { All, Controller, Get, Inject, Req, Res } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { compileTrust, clientIp, type TrustFn } from "../common/client-ip.js";
import { parseWithSchema } from "../common/validation.js";
import { API_ENV } from "../config/config.module.js";

import { mapAuthError } from "./auth-errors.js";
import { AuthSettingsReader } from "./auth-settings.reader.js";
import { CLIENT_IP_HEADER } from "./auth.config.js";
import { AuthPolicy, matchAuthRoute, type AuthRoute, type RouteMatch } from "./auth.policy.js";
import { AUTH } from "./auth.service.js";
import { providerStates } from "./providers.js";

import type { AuthInstance } from "./auth.config.js";
import type { ApiEnv } from "../config/env.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const TURNSTILE_HEADER = "x-turnstile-token";
const REDIRECT_KEYS = [
  "callbackURL",
  "newUserCallbackURL",
  "errorCallbackURL",
  "redirectTo",
] as const;
const HOP_BY_HOP = new Set(["content-length", "transfer-encoding", "connection", "set-cookie"]);

/**
 * Better Auth's response bodies carry things the browser must not hold: the raw session token (it
 * lives in the HttpOnly cookie, and script that can read it can steal it) and full user rows. The
 * web app reads who is signed in from `GET /me`, so only a small user summary survives here.
 */
export function sanitizeSuccess(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const rest = { ...(body as Record<string, unknown>) };
  delete rest["token"];
  delete rest["session"];
  const user = rest["user"];
  if (typeof user === "object" && user !== null) {
    const { id, name, emailVerified, twoFactorEnabled } = user as Record<string, unknown>;
    rest["user"] = { id, name, emailVerified, twoFactorEnabled };
  }
  return rest;
}

/**
 * Mounts Better Auth under `/auth/*`. Every request is matched against the allowlist in
 * `AuthPolicy`, its body is re-validated with the shared zod schema (unknown keys stripped),
 * rate-limited and Turnstile-checked, and only then converted to a Fetch `Request` for
 * `auth.handler`. The answer is translated back: cookies and redirects pass through, errors become
 * our `{ code, message }` shape, and no Better Auth message reaches the client.
 */
@Controller("auth")
export class AuthController {
  private readonly trust: TrustFn;

  constructor(
    @Inject(AUTH) private readonly auth: AuthInstance,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly policy: AuthPolicy,
    private readonly settings: AuthSettingsReader,
  ) {
    this.trust = compileTrust(env.TRUST_PROXY);
  }

  /** Which sign-in buttons the web app draws, and in which state. Public. */
  @Get("providers")
  async providers(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("cache-control", "public, max-age=30");
    return providerStates(this.env, await this.settings.auth());
  }

  @All("*")
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, this.env.API_PUBLIC_URL);
    const path = url.pathname.replace(/^\/auth/, "");
    const match = matchAuthRoute(request.method, path);
    if (!match) throw new AppError(ErrorCode.NOT_FOUND);

    reply.header("cache-control", "no-store");

    // A callback of a provider that is not enabled goes back to the login page, not to a JSON error.
    if (
      match.route.provider === "param" &&
      !(await this.policy.providerEnabled(match.params["id"] ?? ""))
    ) {
      reply.redirect(`${this.webOrigin()}/login?error=provider_unavailable`, 302);
      return;
    }

    const body = this.parseBody(match.route, request);
    const facts = {
      ip: clientIp(request, this.trust),
      body,
      params: match.params,
      turnstileToken: this.header(request, TURNSTILE_HEADER),
    };
    await this.policy.enforce(match, facts);

    const response = await this.auth.handler(
      this.toFetchRequest(request, url, match, body, facts.ip),
    );
    await this.policy.recordOutcome(match, facts, response.status);
    await this.relay(match.route, response, reply);
  }

  private webOrigin(): string {
    return this.env.WEB_ORIGIN[0] ?? "";
  }

  private header(request: FastifyRequest, name: string): string | undefined {
    const value = request.headers[name];
    return typeof value === "string" ? value : undefined;
  }

  private parseBody(
    route: AuthRoute,
    request: FastifyRequest,
  ): Record<string, unknown> | undefined {
    if (route.method === "GET") return undefined;
    const parsed = route.body ? parseWithSchema(route.body, request.body ?? {}) : {};
    const body = { ...(parsed as Record<string, unknown>) };
    for (const key of REDIRECT_KEYS) {
      const value = body[key];
      if (typeof value === "string") body[key] = this.resolveRedirect(value, key);
    }
    return body;
  }

  /** Relative paths are the web app's; absolute URLs must start with one of our own web origins. */
  private resolveRedirect(value: string, field: string): string {
    if (value.startsWith("/")) return `${this.webOrigin()}${value}`;
    const allowed = this.env.WEB_ORIGIN.some(
      (origin) => value === origin || value.startsWith(`${origin}/`),
    );
    if (!allowed) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [field] } });
    }
    return value;
  }

  private toFetchRequest(
    request: FastifyRequest,
    url: URL,
    match: RouteMatch,
    body: Record<string, unknown> | undefined,
    ip: string,
  ): Request {
    const target = new URL(url.pathname, this.env.API_PUBLIC_URL);
    const query = match.route.query;
    if (query !== undefined) {
      for (const [key, value] of url.searchParams) {
        if (query !== "*" && !query.includes(key)) continue;
        target.searchParams.append(
          key,
          (REDIRECT_KEYS as readonly string[]).includes(key)
            ? this.resolveRedirect(value, key)
            : value,
        );
      }
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      // Never forward a client-supplied IP header: ours is the only one Better Auth trusts.
      if (value === undefined || name === "content-length" || name === CLIENT_IP_HEADER) continue;
      for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
    }
    headers.set(CLIENT_IP_HEADER, ip);

    if (request.method === "GET") return new Request(target, { method: "GET", headers });
    headers.set("content-type", "application/json");
    return new Request(target, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  }

  private async relay(route: AuthRoute, response: Response, reply: FastifyReply): Promise<void> {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) reply.header("set-cookie", cookies);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) reply.header("location", location);
      reply.status(response.status).send();
      return;
    }

    if (!response.ok) {
      const errorBody: unknown = await response.json().catch(() => null);
      const mapped = mapAuthError(response.status, errorBody, {
        passwordField: route.passwordField ?? "password",
      });
      if (mapped) throw mapped;
      // A server-side failure: the filter stores it under a WSF- reference; the message stays here.
      const code = (errorBody as { code?: unknown } | null)?.code;
      throw new Error(
        `Better Auth failed (${response.status} ${typeof code === "string" ? code : "no code"})`,
      );
    }

    for (const [name, value] of response.headers) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) reply.header(name, value);
    }
    const text = await response.text();
    if (text === "" || !(response.headers.get("content-type") ?? "").includes("json")) {
      reply.status(response.status).send(text);
      return;
    }
    reply.status(response.status).send(sanitizeSuccess(JSON.parse(text)));
  }
}
