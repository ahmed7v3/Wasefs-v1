import { sql } from "drizzle-orm";
import { expect, it } from "vitest";

import { violatedConstraint } from "./db-fixture.js";

import type { createDb } from "../src/client.js";

/*
 * Shared helpers of the Phase 3 schema tests. Constraint names are part of the contract (the API maps
 * a violated name to an error), so each test file lists them by hand rather than deriving them from
 * the schema: renaming one must be a visible decision.
 */

export type Handle = ReturnType<typeof createDb>;
export type Rule = "cascade" | "restrict" | "set null";

const DELETE_RULE: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

/** Runs a statement that must be rejected and returns the name of the constraint that rejected it. */
export async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return violatedConstraint(error);
  }
  throw new Error("expected the database to reject the statement");
}

/** The SQLSTATE of a failed statement, or undefined when it succeeded. */
export async function sqlState(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const candidate = (error as { cause?: unknown } | null)?.cause ?? error;
    return (candidate as { code?: string }).code;
  }
}

let counter = 0;
export const unique = (prefix: string): string => `${prefix}-${String(++counter)}`;
/** A key that satisfies `^[a-z][a-z0-9_]{1,39}$`. */
export const uniqueKey = (prefix: string): string => `${prefix}_${String(++counter)}`;

export function urlFor(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = encodeURIComponent(password);
  return url.toString();
}

export interface NameSpec {
  checks: readonly string[];
  /** UNIQUE and PRIMARY KEY constraints. */
  uniques: readonly string[];
  /** Plain and partial indexes, including unique indexes. */
  indexes: readonly string[];
  /** [constraint, ON DELETE rule]. */
  foreignKeys: readonly (readonly [string, Rule])[];
}

/** Registers the four "the names exist with the right rules" tests of one schema file. */
export function itHasNames(db: () => Handle["db"], spec: NameSpec): void {
  it("has every CHECK constraint", async () => {
    const rows = await db().execute<{ conname: string }>(
      sql`select conname from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`,
    );
    const present = new Set(rows.map((row) => row.conname));
    expect(spec.checks.filter((name) => !present.has(name))).toEqual([]);
  });

  it("has every foreign key, with the ON DELETE rule the design calls for", async () => {
    const rows = await db().execute<{ conname: string; confdeltype: string }>(
      sql`select conname, confdeltype from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`,
    );
    const present = new Map(rows.map((row) => [row.conname, DELETE_RULE[row.confdeltype]]));
    expect(spec.foreignKeys.map(([name]) => [name, present.get(name)])).toEqual(
      spec.foreignKeys.map(([name, rule]) => [name, rule]),
    );
  });

  it("has every unique constraint and composite primary key", async () => {
    const rows = await db().execute<{ conname: string }>(
      sql`select conname from pg_constraint where contype in ('u', 'p') and connamespace = 'public'::regnamespace`,
    );
    const present = new Set(rows.map((row) => row.conname));
    expect(spec.uniques.filter((name) => !present.has(name))).toEqual([]);
  });

  it("has every index", async () => {
    const rows = await db().execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const present = new Set(rows.map((row) => row.indexname));
    expect(spec.indexes.filter((name) => !present.has(name))).toEqual([]);
  });
}
