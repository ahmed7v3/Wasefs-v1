import { parseEnv } from "@wasfa/shared/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema/index.js";

const dbEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export interface CreateDbOptions {
  /** Defaults to `DATABASE_URL` from the environment (validated; exits with key names if missing). */
  url?: string;
  /** Pool size; keep small, Postgres is tuned for ~50 total connections. */
  max?: number;
  /** Seconds to wait for a new connection; keep low where health checks must fail fast. */
  connectTimeoutSeconds?: number;
}

export function createDb(options: CreateDbOptions = {}) {
  const url = options.url ?? parseEnv(dbEnvSchema).DATABASE_URL;
  const sql = postgres(url, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 30,
    // Extension/IF NOT EXISTS notices are noise, not errors.
    onnotice: () => undefined,
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDb>["db"];
