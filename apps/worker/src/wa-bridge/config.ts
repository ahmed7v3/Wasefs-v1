import { parseEnv } from "@wasfa/shared/env";
import { z } from "zod";

/** Environment of the `wa-bridge` process: Redis (streams), Postgres (auth state) and the encryption key. */
export const bridgeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32,
      "must be 32 bytes, base64-encoded",
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** One linked number per session name. */
  WA_SESSION: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,31}$/)
    .default("default"),
});

export type BridgeEnv = z.output<typeof bridgeEnvSchema>;

export function loadBridgeEnv(source: Record<string, string | undefined> = process.env): BridgeEnv {
  return parseEnv(bridgeEnvSchema, source);
}
