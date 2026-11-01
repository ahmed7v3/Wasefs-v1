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

async function turn(conversationId: string, state = "queued"): Promise<string> {
  const rows = await fixture.handle.db.execute(
    sql`insert into wa_turns (conversation_id, state, fence) values (${conversationId}, ${state}, 1) returning id`,
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

describe("agent runtime migration (0032)", () => {
  it("applies on a fresh database with fence defaulting to 0", async () => {
    const id = await conversation("fence@s.whatsapp.net");
    const rows = await fixture.handle.db.execute(
      sql`select turn_fence from wa_conversations where id = ${id}`,
    );
    expect(Number(rows[0]?.turn_fence)).toBe(0);
  });

  it("rejects values outside the closed sets", async () => {
    const c = await conversation("checks@s.whatsapp.net");
    const { db } = fixture.handle;
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_turns (conversation_id, state, fence) values (${c}, 'bogus', 1)`,
        ),
      ),
    ).toBe("wa_turns_state_check");
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_turns (conversation_id, state, fence, cause_class) values (${c}, 'queued', 1, 'bogus')`,
        ),
      ),
    ).toBe("wa_turns_cause_class_check");
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_turns (conversation_id, state, fence, trace) values (${c}, 'queued', 1, '[]')`,
        ),
      ),
    ).toBe("wa_turns_trace_check");
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_outbox (conversation_id, kind, idempotency_key, state) values (${c}, 'rx_result', 'k-bad-state', 'bogus')`,
        ),
      ),
    ).toBe("wa_outbox_state_check");
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_messages (conversation_id, direction, kind, status, media_status) values (${c}, 'in', 'image', 'received', 'bogus')`,
        ),
      ),
    ).toBe("wa_messages_media_status_check");
    const t = await turn(c);
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_tool_effects (key, turn_id, tool, state) values ('k-bad', ${t}, 'x', 'bogus')`,
        ),
      ),
    ).toBe("wa_tool_effects_state_check");
  });

  it("keeps wa_outbox.idempotency_key unique", async () => {
    const c = await conversation("outbox-unique@s.whatsapp.net");
    const { db } = fixture.handle;
    await db.execute(
      sql`insert into wa_outbox (conversation_id, kind, idempotency_key, state) values (${c}, 'notice', 'rx:same', 'waiting')`,
    );
    expect(
      await constraintOf(
        db.execute(
          sql`insert into wa_outbox (conversation_id, kind, idempotency_key, state) values (${c}, 'notice', 'rx:same', 'waiting')`,
        ),
      ),
    ).toBe("wa_outbox_idempotency_key_key");
  });

  it("cascades turns, effects and outbox with the conversation", async () => {
    const c = await conversation("cascade@s.whatsapp.net");
    const { db } = fixture.handle;
    const t = await turn(c);
    await db.execute(
      sql`insert into wa_tool_effects (key, turn_id, tool, state) values ('k-cascade', ${t}, 'x', 'pending')`,
    );
    await db.execute(
      sql`insert into wa_outbox (conversation_id, kind, idempotency_key, state) values (${c}, 'notice', 'k-cascade-out', 'ready')`,
    );
    await db.execute(sql`delete from wa_conversations where id = ${c}`);
    for (const table of ["wa_turns", "wa_outbox"]) {
      const rows = await db.execute(
        sql`select count(*)::int as n from ${sql.raw(table)} where conversation_id = ${c}`,
      );
      expect(rows[0]?.n, table).toBe(0);
    }
    const effects = await db.execute(
      sql`select count(*)::int as n from wa_tool_effects where key = 'k-cascade'`,
    );
    expect(effects[0]?.n).toBe(0);
  });

  it("sets wa_messages.turn_id to null when its turn is deleted", async () => {
    const c = await conversation("setnull@s.whatsapp.net");
    const { db } = fixture.handle;
    const t = await turn(c, "replied");
    const rows = await db.execute(
      sql`insert into wa_messages (conversation_id, direction, kind, status, turn_id) values (${c}, 'in', 'text', 'received', ${t}) returning id`,
    );
    const messageId = String(rows[0]?.id);
    await db.execute(sql`delete from wa_turns where id = ${t}`);
    const after = await db.execute(sql`select turn_id from wa_messages where id = ${messageId}`);
    expect(after).toHaveLength(1);
    expect(after[0]?.turn_id).toBeNull();
  });
});
