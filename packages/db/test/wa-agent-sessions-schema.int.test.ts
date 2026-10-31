import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startTestDb, violatedConstraint, type TestDb } from "./db-fixture.js";

let fixture: TestDb;
beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);
afterAll(async () => {
  await fixture?.stop();
});

async function conversation(jid: string): Promise<string> {
  const rows = await fixture.handle.db.execute(
    sql`insert into wa_conversations (jid) values (${jid}) returning id`,
  );
  return String(rows[0]?.id);
}

async function session(conversationId: string): Promise<string> {
  const rows = await fixture.handle.db.execute(
    sql`insert into wa_agent_sessions (conversation_id) values (${conversationId}) returning id`,
  );
  return String(rows[0]?.id);
}

async function constraintOf(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
  } catch (error) {
    return violatedConstraint(error);
  }
  return undefined;
}

describe("agent sessions migration (0033)", () => {
  it("defaults a new session and a conversation's profile", async () => {
    const c = await conversation("defaults@s.whatsapp.net");
    const s = await session(c);
    const { db } = fixture.handle;
    const rows = await db.execute(
      sql`select returning, summarized_count, next_handle, state, ended_at from wa_agent_sessions where id = ${s}`,
    );
    expect(rows[0]).toMatchObject({
      returning: false,
      summarized_count: 0,
      next_handle: 1,
      state: {},
    });
    expect(rows[0]?.ended_at).toBeNull();
    const conv = await db.execute(
      sql`select profile, session_id from wa_conversations where id = ${c}`,
    );
    expect(conv[0]?.profile).toEqual({});
    expect(conv[0]?.session_id).toBeNull();
  });

  it("only accepts the closed set of end reasons", async () => {
    const c = await conversation("reason@s.whatsapp.net");
    const { db } = fixture.handle;
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_agent_sessions (conversation_id, end_reason) values (${c}, 'bogus')`,
        ),
      ),
    ).toBe("wa_agent_sessions_end_reason_check");
    for (const reason of ["command", "idle", "privacy"]) {
      await db.execute(
        sql`insert into wa_agent_sessions (conversation_id, end_reason) values (${c}, ${reason})`,
      );
    }
  });

  it("keeps (session_id, handle) unique only for rows that have a handle", async () => {
    const c = await conversation("handle@s.whatsapp.net");
    const s = await session(c);
    const other = await session(c);
    const { db } = fixture.handle;
    const insert = (sessionId: string, handle: number | null) =>
      db.execute(
        sql`insert into wa_messages (conversation_id, direction, kind, status, session_id, handle) values (${c}, 'in', 'image', 'received', ${sessionId}, ${handle})`,
      );
    await insert(s, 1);
    await insert(other, 1);
    await insert(s, null);
    await insert(s, null);
    expect(await constraintOf(insert(s, 1))).toBe("wa_messages_session_handle_key");
  });

  it("sets session_id to null when the session is deleted and cascades with the conversation", async () => {
    const c = await conversation("delete@s.whatsapp.net");
    const s = await session(c);
    const { db } = fixture.handle;
    await db.execute(sql`update wa_conversations set session_id = ${s} where id = ${c}`);
    const rows = await db.execute(
      sql`insert into wa_messages (conversation_id, direction, kind, status, session_id) values (${c}, 'in', 'text', 'received', ${s}) returning id`,
    );
    await db.execute(sql`delete from wa_agent_sessions where id = ${s}`);
    const msg = await db.execute(
      sql`select session_id from wa_messages where id = ${String(rows[0]?.id)}`,
    );
    expect(msg[0]?.session_id).toBeNull();
    const conv = await db.execute(sql`select session_id from wa_conversations where id = ${c}`);
    expect(conv[0]?.session_id).toBeNull();

    const c2 = await conversation("cascade2@s.whatsapp.net");
    await session(c2);
    await db.execute(sql`delete from wa_conversations where id = ${c2}`);
    const left = await db.execute(
      sql`select count(*)::int as n from wa_agent_sessions where conversation_id = ${c2}`,
    );
    expect(left[0]?.n).toBe(0);
  });
});
