import { randomBytes, randomInt } from "node:crypto";

import { Global, Module } from "@nestjs/common";
import { users, type createDb } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";

import { AUTH_MAILER, type AuthMailer } from "../../src/auth/mailer.js";
import { apiEnvSchema, type ApiEnv } from "../../src/config/env.js";

import type { TestInfra } from "./infra.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";

export const WEB = "https://wasfa.online";
export const PASSWORD = "correct horse battery";

/** Every test env is valid for production-like cookie settings; mail is captured by the harness. */
export function testApiEnv(
  infra: TestInfra,
  overrides: Record<string, string | number> = {},
): ApiEnv {
  return apiEnvSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    WEB_ORIGIN: WEB,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    API_PUBLIC_URL: "https://api.wasfa.online",
    AUTH_COOKIE_DOMAIN: ".wasfa.online",
    ARGON2_MEMORY_KIB: 8192,
    LOG_LEVEL: "silent",
    ...overrides,
  });
}

/** Breached-password lookups: nothing is breached. */
export const pwnedHandlers = () => [
  http.get("https://api.pwnedpasswords.com/range/:prefix", () =>
    HttpResponse.text("0000000000000000000000000000000000A:1"),
  ),
];

export interface Mail {
  kind: "verify" | "reset";
  to: string;
  url: string;
}

export type Jar = Map<string, string>;

const randomIp = () => `10.${randomInt(1, 200)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

/**
 * Drives the real auth endpoints in integration tests: captures mail, keeps cookie jars, and turns
 * "give me a signed-in user" into one call. Create it before the app, pass `mailerModule()` to
 * `createApp(env, { extraImports: [...], authMailer: false })`.
 */
export class AuthHarness {
  readonly mails: Mail[] = [];
  private counter = 0;

  constructor(
    private readonly getApp: () => NestFastifyApplication,
    private readonly getDb: () => ReturnType<typeof createDb>["db"],
  ) {}

  mailerModule() {
    const mailer: AuthMailer = {
      sendVerificationEmail: ({ to, url }) => {
        this.mails.push({ kind: "verify", to, url });
        return Promise.resolve();
      },
      sendPasswordResetEmail: ({ to, url }) => {
        this.mails.push({ kind: "reset", to, url });
        return Promise.resolve();
      },
    };
    @Global()
    @Module({ providers: [{ provide: AUTH_MAILER, useValue: mailer }], exports: [AUTH_MAILER] })
    class MailerHarnessModule {}
    return MailerHarnessModule;
  }

  nextEmail(): string {
    return `user${++this.counter}-${randomBytes(3).toString("hex")}@example.com`;
  }

  private absorb(jar: Jar, res: LightMyRequestResponse): void {
    for (const line of [res.headers["set-cookie"] ?? []].flat()) {
      const [pair = "", ...attributes] = line.split(/;\s*/);
      const [name = "", ...rest] = pair.split("=");
      const value = rest.join("=");
      const expired = attributes.some((a) => /^max-age=0$/i.test(a)) || value === "";
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
  }

  async call(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    options: {
      body?: Record<string, unknown>;
      jar?: Jar;
      ip?: string;
      headers?: Record<string, string>;
      origin?: string | null;
    } = {},
  ) {
    const jar = options.jar ?? new Map();
    const origin = options.origin === undefined ? WEB : options.origin;
    const res = await this.getApp().inject({
      method,
      url,
      remoteAddress: options.ip ?? randomIp(),
      headers: {
        ...(origin ? { origin } : {}),
        ...(jar.size > 0
          ? { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") }
          : {}),
        ...options.headers,
      },
      ...(method === "GET" || method === "DELETE" ? {} : { payload: options.body ?? {} }),
    });
    this.absorb(jar, res);
    return res;
  }

  /** Registers, follows the captured verification link, signs in. */
  async signedInUser(
    options: { email?: string; password?: string } = {},
  ): Promise<{ email: string; jar: Jar; userId: string }> {
    const email = options.email ?? this.nextEmail();
    const password = options.password ?? PASSWORD;
    const registered = await this.call("POST", "/auth/sign-up/email", {
      body: { name: "Test User", email, password, callbackURL: "/login?verified=1" },
      headers: { "x-turnstile-token": "pass" },
    });
    if (registered.statusCode !== 200) throw new Error(`sign-up failed: ${registered.body}`);
    const mail = this.mails.find((m) => m.kind === "verify" && m.to === email);
    if (!mail) throw new Error("no verification mail captured");
    const link = new URL(mail.url);
    await this.call("GET", `${link.pathname}${link.search}`);
    const jar: Jar = new Map();
    const signedIn = await this.call("POST", "/auth/sign-in/email", {
      body: { email, password },
      jar,
    });
    if (signedIn.statusCode !== 200) throw new Error(`sign-in failed: ${signedIn.body}`);
    const [row] = await this.getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (!row) throw new Error("user row missing");
    return { email, jar, userId: row.id };
  }
}
