import { NotFoundException } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { clientIp, compileTrust } from "../src/common/client-ip.js";
import { toAppError } from "../src/common/errors.js";
import { ZodValidationPipe, createZodDto } from "../src/common/validation.js";
import { apiEnvSchema } from "../src/config/env.js";

import type { FastifyRequest } from "fastify";

const validEnv = {
  DATABASE_URL: "postgres://wasfa:pw@localhost:5432/wasfa",
  REDIS_URL: "redis://localhost:6379",
  WEB_ORIGIN: "https://wasfa.online, http://localhost:3000",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("apiEnvSchema", () => {
  it("parses a valid env with defaults", () => {
    const env = apiEnvSchema.parse(validEnv);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.WEB_ORIGIN).toEqual(["https://wasfa.online", "http://localhost:3000"]);
    expect(env.TRUST_PROXY).toEqual([]);
    expect(env.RATE_LIMIT_MAX).toBe(120);
  });

  it("rejects origins with paths and short encryption keys", () => {
    const result = apiEnvSchema.safeParse({
      ...validEnv,
      WEB_ORIGIN: "https://wasfa.online/app",
      ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
    });
    expect(result.success).toBe(false);
    const keys = result.error?.issues.map((issue) => issue.path[0]);
    expect(keys).toEqual(expect.arrayContaining(["WEB_ORIGIN", "ENCRYPTION_KEY"]));
  });

  it("accepts IPs and CIDRs in TRUST_PROXY and rejects junk", () => {
    expect(
      apiEnvSchema.parse({ ...validEnv, TRUST_PROXY: "172.18.0.0/16, ::1" }).TRUST_PROXY,
    ).toEqual(["172.18.0.0/16", "::1"]);
    expect(apiEnvSchema.safeParse({ ...validEnv, TRUST_PROXY: "caddy" }).success).toBe(false);
    expect(apiEnvSchema.safeParse({ ...validEnv, TRUST_PROXY: "10.0.0.0/40" }).success).toBe(false);
  });
});

function fakeRequest(peer: string, headers: Record<string, string> = {}): FastifyRequest {
  return { socket: { remoteAddress: peer }, ip: peer, headers } as unknown as FastifyRequest;
}

describe("clientIp", () => {
  const trust = compileTrust(["172.18.0.0/16"]);

  it("uses CF-Connecting-IP only when the peer is the trusted proxy", () => {
    expect(clientIp(fakeRequest("172.18.0.5", { "cf-connecting-ip": "41.33.1.2" }), trust)).toBe(
      "41.33.1.2",
    );
    expect(clientIp(fakeRequest("8.8.8.8", { "cf-connecting-ip": "41.33.1.2" }), trust)).toBe(
      "8.8.8.8",
    );
  });

  it("ignores a malformed CF-Connecting-IP", () => {
    expect(clientIp(fakeRequest("172.18.0.5", { "cf-connecting-ip": "evil" }), trust)).toBe(
      "172.18.0.5",
    );
  });

  it("trusts nobody when no proxies are configured", () => {
    const none = compileTrust([]);
    expect(clientIp(fakeRequest("172.18.0.5", { "cf-connecting-ip": "1.2.3.4" }), none)).toBe(
      "172.18.0.5",
    );
  });
});

describe("toAppError", () => {
  it("keeps AppErrors and maps HTTP/Fastify errors", () => {
    const appError = new AppError(ErrorCode.FORBIDDEN);
    expect(toAppError(appError)).toBe(appError);
    expect(toAppError(new NotFoundException())?.code).toBe(ErrorCode.NOT_FOUND);
    const tooLarge = Object.assign(new Error("too large"), { statusCode: 413 });
    expect(toAppError(tooLarge)).toMatchObject({ code: "VALIDATION_FAILED", httpStatus: 413 });
  });

  it("treats unknown and 5xx errors as unexpected", () => {
    expect(toAppError(new Error("boom"))).toBeUndefined();
    expect(toAppError(Object.assign(new Error("x"), { statusCode: 503 }))).toBeUndefined();
  });
});

describe("ZodValidationPipe", () => {
  class SignupDto extends createZodDto(
    z.object({ name: z.string().min(2), profile: z.object({ age: z.number().int() }) }),
  ) {}
  const pipe = new ZodValidationPipe();
  const meta = { type: "body", metatype: SignupDto } as const;

  it("strips unknown keys", () => {
    expect(pipe.transform({ name: "Ali", profile: { age: 30 }, role: "admin" }, meta)).toEqual({
      name: "Ali",
      profile: { age: 30 },
    });
  });

  it("reports field paths without echoing values", () => {
    try {
      pipe.transform({ name: "s3cr3t-x".slice(0, 1), profile: { age: "secret-value" } }, meta);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const response = (error as AppError).toResponse("en");
      expect(response.code).toBe("VALIDATION_FAILED");
      expect(response.details).toEqual({ fields: ["name", "profile.age"] });
      expect(JSON.stringify(response)).not.toContain("secret-value");
    }
  });

  it("passes through parameters without a zod schema", () => {
    expect(pipe.transform("abc", { type: "param", metatype: String })).toBe("abc");
  });
});
