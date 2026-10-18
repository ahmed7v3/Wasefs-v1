import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/client.js";
import { API_DB_ROLE, setApiRolePassword } from "../src/migrations.js";
import { auditLogs, users } from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

let fixture: TestDb;
let api: ReturnType<typeof createDb>;
// A quote and a backslash on purpose: the password must be quoted by Postgres, not by string glue.
const PASSWORD = String.raw`p'a\ss word-1`;

function urlFor(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = encodeURIComponent(password);
  return url.toString();
}

beforeAll(async () => {
  fixture = await startTestDb();
  await setApiRolePassword(fixture.handle.db, PASSWORD);
  api = createDb({ url: urlFor(fixture.url, API_DB_ROLE, PASSWORD), max: 1 });
}, 180_000);

afterAll(async () => {
  await api?.close();
  await fixture?.stop();
});

async function sqlState(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const candidate = (error as { cause?: unknown } | null)?.cause ?? error;
    return (candidate as { code?: string }).code;
  }
}

describe("the API database role", () => {
  it("can log in once the deploy has set its password", async () => {
    const [row] = await api.db.execute<{ current_user: string }>(sql`select current_user`);
    expect(row?.current_user).toBe(API_DB_ROLE);
  });

  it("can append to and read the audit log", async () => {
    await api.db.insert(auditLogs).values({ action: "test.write", targetType: "test" });
    const rows = await api.db.select().from(auditLogs);
    expect(rows.some((row) => row.action === "test.write")).toBe(true);
  });

  it("cannot UPDATE, DELETE or TRUNCATE audit_logs (permission denied)", async () => {
    expect(await sqlState(api.db.execute(sql`update audit_logs set action = 'tampered'`))).toBe(
      "42501",
    );
    expect(await sqlState(api.db.execute(sql`delete from audit_logs`))).toBe("42501");
    expect(await sqlState(api.db.execute(sql`truncate audit_logs`))).toBe("42501");
    const rows = await fixture.handle.db.select().from(auditLogs);
    expect(rows.every((row) => row.action !== "tampered")).toBe(true);
  });

  it("is append-only on every ledger and event table: SELECT and INSERT, never UPDATE, DELETE or TRUNCATE", async () => {
    const appendOnly = [
      "audit_logs",
      "credit_ledger",
      "points_ledger",
      "payment_events",
      "subscription_events",
    ];
    for (const table of appendOnly) {
      expect(await sqlState(api.db.execute(sql.raw(`update ${table} set id = id`)))).toBe("42501");
      expect(await sqlState(api.db.execute(sql.raw(`delete from ${table}`)))).toBe("42501");
      expect(await sqlState(api.db.execute(sql.raw(`truncate ${table}`)))).toBe("42501");
      expect(
        await sqlState(api.db.execute(sql.raw(`select count(*) from ${table}`))),
      ).toBeUndefined();
      const [privileges] = await api.db.execute<{ allowed: boolean }>(
        sql`select has_table_privilege(current_user, ${table}, 'INSERT') as allowed`,
      );
      expect(privileges?.allowed).toBe(true);
    }
  });

  it("can use the order number sequence and still update the money tables that are not append-only", async () => {
    const [sequence] = await api.db.execute<{ allowed: boolean }>(
      sql`select has_sequence_privilege(current_user, 'order_number_seq', 'USAGE') as allowed`,
    );
    expect(sequence?.allowed).toBe(true);
    for (const table of [
      "orders",
      "payments",
      "refunds",
      "points_wallets",
      "withdrawal_requests",
    ]) {
      const [privileges] = await api.db.execute<{ allowed: boolean }>(
        sql`select has_table_privilege(current_user, ${table}, 'UPDATE') as allowed`,
      );
      expect(privileges?.allowed).toBe(true);
    }
  });

  it("can read and write the other tables", async () => {
    const [user] = await api.db
      .insert(users)
      .values({ name: "Role Test", email: "role-test@example.com" })
      .returning({ id: users.id });
    expect(user?.id).toBeTruthy();
    await api.db.execute(
      sql`update users set name = 'Renamed' where email = 'role-test@example.com'`,
    );
    await api.db.execute(sql`delete from users where email = 'role-test@example.com'`);
  });

  it("owns nothing and cannot change the schema", async () => {
    expect(await sqlState(api.db.execute(sql`create table sneaky (id int)`))).toBe("42501");
    expect(await sqlState(api.db.execute(sql`alter table users add column sneaky int`))).toBe(
      "42501",
    );
    expect(await sqlState(api.db.execute(sql`drop table audit_logs`))).toBe("42501");
  });

  it("gets access to tables created by later migrations without another grant", async () => {
    await fixture.handle.db.execute(sql`create table later_table (id int)`);
    expect(await sqlState(api.db.execute(sql`insert into later_table values (1)`))).toBeUndefined();
    await fixture.handle.db.execute(sql`drop table later_table`);
  });

  it("is still maintainable by the owner (retention jobs and migrations run as the owner)", async () => {
    expect(
      await sqlState(fixture.handle.db.execute(sql`update audit_logs set action = action`)),
    ).toBeUndefined();
  });
});
