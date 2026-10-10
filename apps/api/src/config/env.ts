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

export const apiEnvSchema = z.object({
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
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type ApiEnv = z.output<typeof apiEnvSchema>;

/** Validates `process.env` (or `source`) at boot; prints bad key names and exits on failure. */
export function loadEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return parseEnv(apiEnvSchema, source);
}

export function encryptionKey(env: ApiEnv): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, "base64");
}
