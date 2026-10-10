import { isIP } from "node:net";

import { parseEnv } from "@wasfa/shared/env";
import { z } from "zod";

const csv = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/** An exact origin: scheme + host (+ port), nothing else. CORS compares it byte-for-byte. */
const originSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch {
    return false;
  }
}, "must be an exact origin like https://wasfa.online");

/** A single IP or an IPv4/IPv6 CIDR, as accepted by `proxy-addr`. */
const proxyAddressSchema = z.string().refine((value) => {
  const [address = "", prefix, ...rest] = value.split("/");
  if (rest.length > 0 || isIP(address) === 0) return false;
  if (prefix === undefined) return true;
  const bits = Number(prefix);
  return Number.isInteger(bits) && bits >= 0 && bits <= (isIP(address) === 4 ? 32 : 128);
}, "must be an IP address or CIDR");

const encryptionKeySchema = z
  .string()
  .refine(
    (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32,
    "must be 32 bytes, base64-encoded",
  );

/** Blank values (`KEY=` in a compose file) count as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** `.wasfa.online` or `wasfa.online`: the Domain attribute of the session cookie. */
const cookieDomainSchema = z
  .string()
  .toLowerCase()
  .regex(/^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);

const hostOf = (origin: string) => new URL(origin).hostname;

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Comma-separated exact origins allowed to call the API with credentials. */
    WEB_ORIGIN: z.string().transform(csv).pipe(z.array(originSchema).min(1)),
    /** AES-256-GCM key for admin-stored secrets: `openssl rand -base64 32`. */
    ENCRYPTION_KEY: encryptionKeySchema,
    /** Comma-separated IPs/CIDRs of the reverse proxy (Caddy). Empty = trust no proxy. */
    TRUST_PROXY: z.string().default("").transform(csv).pipe(z.array(proxyAddressSchema)),
    /** Global per-IP requests per minute; stricter limits are set per route. */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    // --- Authentication (Better Auth) ---
    /** Signs sessions' cookies and verification tokens: `openssl rand -base64 48`. Rotating it signs everyone out. */
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Public origin of this API, used in links Better Auth generates (verification, OAuth callbacks). */
    API_PUBLIC_URL: originSchema.default("http://localhost:4000"),
    /** Domain of the session cookie so `wasfa.online` and `api.wasfa.online` share it. Unset = host-only (local dev). */
    AUTH_COOKIE_DOMAIN: optional(cookieDomainSchema),
    /** Argon2id memory cost in KiB (OWASP minimum 19456 with timeCost 2, parallelism 1). */
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8_192).max(1_048_576).default(19_456),
    /** Cloudflare Turnstile secret. Required in production; unset elsewhere disables the check. */
    TURNSTILE_SECRET_KEY: optional(z.string().min(1)),
    /** Social providers. A provider without both keys can never be enabled. */
    GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
    FACEBOOK_CLIENT_ID: optional(z.string().min(1)),
    FACEBOOK_CLIENT_SECRET: optional(z.string().min(1)),

    // --- Phone verification (WhatsApp inbound, Task 1.5) ---
    /** The business number users send the code to, digits with country code (a leading + is accepted). Unset = phone verification unavailable. */
    WHATSAPP_NUMBER: optional(
      z
        .string()
        .transform((value) => value.replace(/^\+/, ""))
        .pipe(z.string().regex(/^[1-9]\d{7,14}$/)),
    ),
  })
  .superRefine((env, ctx) => {
    const issue = (key: keyof typeof env, message: string) =>
      ctx.addIssue({ code: "custom", path: [key], message });

    for (const [id, secret] of [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
    ] as const) {
      if ((env[id] === undefined) !== (env[secret] === undefined)) {
        issue(env[id] === undefined ? id : secret, "must be set together with its pair");
      }
    }

    if (env.AUTH_COOKIE_DOMAIN) {
      const domain = env.AUTH_COOKIE_DOMAIN.replace(/^\./, "");
      const covered = (origin: string) => {
        const host = hostOf(origin);
        return host === domain || host.endsWith(`.${domain}`);
      };
      if (!env.WEB_ORIGIN.every(covered) || !covered(env.API_PUBLIC_URL)) {
        issue("AUTH_COOKIE_DOMAIN", "must cover every WEB_ORIGIN host and the API_PUBLIC_URL host");
      }
    }

    if (env.NODE_ENV === "production") {
      if (!env.AUTH_COOKIE_DOMAIN) issue("AUTH_COOKIE_DOMAIN", "is required in production");
      if (!env.TURNSTILE_SECRET_KEY) issue("TURNSTILE_SECRET_KEY", "is required in production");
      if (!env.API_PUBLIC_URL.startsWith("https://")) {
        issue("API_PUBLIC_URL", "must be https in production");
      }
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

/** Validates `process.env` (or `source`) at boot; prints bad key names and exits on failure. */
export function loadEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}

export function encryptionKey(env: ApiEnv): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "base64");
}
