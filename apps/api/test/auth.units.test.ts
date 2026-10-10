import { ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import { mapAuthError } from "../src/auth/auth-errors.js";
import { sanitizeSuccess } from "../src/auth/auth.controller.js";
import { AUTH_ROUTES, matchAuthRoute } from "../src/auth/auth.policy.js";
import { isBlockedEmailDomain } from "../src/auth/disposable-domains.js";
import { createPasswordHasher } from "../src/auth/password.js";
import { AuthRateLimiter, identifierKey } from "../src/auth/rate-limiter.js";

import type { Redis } from "ioredis";

describe("AuthRateLimiter fails closed", () => {
  const brokenRedis = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("redis is down");
      },
    },
  ) as unknown as Redis;
  const limiter = new AuthRateLimiter(brokenRedis);

  it("refuses to count when Redis is unreachable, instead of letting the request through", async () => {
    await expect(limiter.hit("login:ip:1.2.3.4", 10, 900)).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
    });
    await expect(limiter.failures("a@example.com")).rejects.toMatchObject({
      code: ErrorCode.UPSTREAM_UNAVAILABLE,
    });
  });

  it("does not let a failure-counter outage break the sign-in response itself", async () => {
    await expect(limiter.recordFailure("a@example.com")).resolves.toBeUndefined();
    await expect(limiter.clearFailures("a@example.com")).resolves.toBeUndefined();
  });

  it("keys counters by a hash, never by the email or phone", () => {
    const key = identifierKey(" Ali@Example.com ");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toBe(identifierKey("ali@example.com"));
    expect(key).not.toContain("ali");
  });
});

describe("matchAuthRoute (the allowlist)", () => {
  it("matches exact paths and extracts path parameters", () => {
    expect(matchAuthRoute("POST", "/sign-in/email")?.route.bucket).toBe("login");
    expect(matchAuthRoute("GET", "/callback/google")?.params).toEqual({ id: "google" });
    expect(matchAuthRoute("GET", "/reset-password/abc123")?.params).toEqual({ token: "abc123" });
  });

  it("is method-sensitive and rejects everything not listed", () => {
    expect(matchAuthRoute("GET", "/sign-in/email")).toBeUndefined();
    expect(matchAuthRoute("POST", "/callback/google")).toBeUndefined();
    expect(matchAuthRoute("POST", "/sign-in/email/")).toBeUndefined();
    expect(matchAuthRoute("POST", "/sign-in")).toBeUndefined();
    expect(matchAuthRoute("POST", "/phone-number/send-otp")).toBeUndefined();
    expect(matchAuthRoute("POST", "/callback/")).toBeUndefined();
    expect(matchAuthRoute("DELETE", "/sign-out")).toBeUndefined();
  });

  it("gives every route that can send mail or create an account a per-IP limit and Turnstile", () => {
    const sensitive = AUTH_ROUTES.filter((route) =>
      [
        "/sign-up/email",
        "/sign-up/phone-number",
        "/request-password-reset",
        "/send-verification-email",
      ].includes(route.pattern),
    );
    expect(sensitive).toHaveLength(4);
    for (const route of sensitive) {
      expect(route.perIp, route.pattern).toBeDefined();
      expect(route.turnstile, route.pattern).toBe("always");
    }
  });

  it("gives every POST route a body schema, except sign-out", () => {
    for (const route of AUTH_ROUTES.filter(
      (r) => r.method === "POST" && r.pattern !== "/sign-out",
    )) {
      expect(route.body, route.pattern).toBeDefined();
    }
  });

  it("limits every route per IP", () => {
    for (const route of AUTH_ROUTES) expect(route.perIp, route.pattern).toBeDefined();
  });
});

describe("mapAuthError", () => {
  const context = { passwordField: "password" };

  it("turns every credential failure into the same AUTH_REQUIRED", () => {
    for (const code of ["INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "INVALID_CREDENTIALS"]) {
      const error = mapAuthError(401, { code, message: "secret detail" }, context);
      expect(error?.code).toBe(ErrorCode.AUTH_REQUIRED);
      expect(error?.details).toEqual({ reason: "invalid_credentials" });
    }
  });

  it("points password errors at the right field", () => {
    expect(
      mapAuthError(400, { code: "PASSWORD_COMPROMISED" }, { passwordField: "newPassword" })
        ?.details,
    ).toEqual({
      reason: "password_compromised",
      fields: ["newPassword"],
    });
  });

  it("never forwards Better Auth's message text", () => {
    const error = mapAuthError(
      400,
      { code: "SOMETHING_NEW", message: "better-auth leaked SQL" },
      context,
    );
    expect(JSON.stringify(error?.toResponse("en"))).not.toMatch(/better-auth|SQL/);
  });

  it("falls back on the status for unknown codes", () => {
    expect(mapAuthError(401, {}, context)?.code).toBe(ErrorCode.AUTH_REQUIRED);
    expect(mapAuthError(403, null, context)?.code).toBe(ErrorCode.FORBIDDEN);
    expect(mapAuthError(404, {}, context)?.code).toBe(ErrorCode.NOT_FOUND);
    expect(mapAuthError(429, {}, context)?.code).toBe(ErrorCode.RATE_LIMITED);
    expect(mapAuthError(422, {}, context)?.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it("leaves server errors to be reported with a reference", () => {
    expect(mapAuthError(500, { code: "ANYTHING" }, context)).toBeUndefined();
  });
});

describe("sanitizeSuccess", () => {
  it("drops the session token and reduces the user to a summary", () => {
    expect(
      sanitizeSuccess({
        token: "raw-session-token",
        session: { token: "raw" },
        redirect: false,
        user: {
          id: "u1",
          name: "A",
          emailVerified: true,
          email: "a@x.com",
          image: "i",
          phone: "+2010",
        },
      }),
    ).toEqual({
      redirect: false,
      user: { id: "u1", name: "A", emailVerified: true, twoFactorEnabled: undefined },
    });
  });

  it("keeps what the web app needs: redirect URLs and the two-factor challenge", () => {
    expect(sanitizeSuccess({ url: "https://accounts.google.com/x", redirect: true })).toEqual({
      url: "https://accounts.google.com/x",
      redirect: true,
    });
    expect(sanitizeSuccess({ twoFactorRedirect: true })).toEqual({ twoFactorRedirect: true });
    expect(sanitizeSuccess([1, 2])).toEqual([1, 2]);
  });
});

describe("isBlockedEmailDomain", () => {
  it("blocks listed domains, their subdomains and mixed case", () => {
    expect(isBlockedEmailDomain("a@mailinator.com")).toBe(true);
    expect(isBlockedEmailDomain("a@Mail.Mailinator.COM")).toBe(true);
    expect(isBlockedEmailDomain("a@gmail.com")).toBe(false);
    expect(isBlockedEmailDomain("a@notmailinator.com")).toBe(false);
  });

  it("honours the admin-extended list the same way", () => {
    expect(isBlockedEmailDomain("a@x.corp.test", ["corp.test"])).toBe(true);
    expect(isBlockedEmailDomain("a@corp.test", [])).toBe(false);
  });

  it("does not mistake a malformed address for a match", () => {
    expect(isBlockedEmailDomain("mailinator.com")).toBe(false);
    expect(isBlockedEmailDomain("")).toBe(false);
  });
});

describe("createPasswordHasher", () => {
  const hasher = createPasswordHasher(8192);

  it("produces Argon2id hashes with the configured parameters", async () => {
    const hash = await hasher.hash("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=8192,t=2,p=1\$/);
    expect(await hasher.verify({ hash, password: "correct horse battery" })).toBe(true);
    expect(await hasher.verify({ hash, password: "wrong" })).toBe(false);
  });

  it("treats a malformed or foreign hash as a failed login, not an error", async () => {
    expect(await hasher.verify({ hash: "not-a-hash", password: "x" })).toBe(false);
    expect(await hasher.verify({ hash: "", password: "x" })).toBe(false);
  });

  it("offers a stable dummy hash for equalizing the work of unknown accounts", async () => {
    const dummy = await hasher.dummyHash();
    expect(dummy).toMatch(/^\$argon2id\$/);
    expect(await hasher.dummyHash()).toBe(dummy);
    expect(await hasher.verify({ hash: dummy, password: "anything" })).toBe(false);
  });
});
