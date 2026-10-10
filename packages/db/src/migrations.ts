import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { Database } from "./client.js";

/** Absolute path to the SQL migrations shipped with this package (works from `src` and `dist`). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

/** The database role the API and the WhatsApp bridge connect as (created by migration 0005). */
export const API_DB_ROLE = "wasfa_api";

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Lets `API_DB_ROLE` log in with `password`. The password never appears in a migration or the
 * repository: the deploy's `migrate` step passes it from `API_DB_PASSWORD`, so rotating it is "change
 * the variable and run migrate". The statement is built by Postgres' own `format('%L')`, which quotes
 * the literal, rather than by string concatenation here.
 */
export async function setApiRolePassword(db: Database, password: string): Promise<void> {
  const rows = await db.execute<{ statement: string }>(
    sql`select format('ALTER ROLE ${sql.raw(API_DB_ROLE)} WITH LOGIN PASSWORD %L', ${password}::text) as statement`,
  );
  const statement = rows[0]?.statement;
  if (statement === undefined) throw new Error("Could not build the ALTER ROLE statement");
  await db.execute(sql.raw(statement));
}
