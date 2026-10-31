import { randomUUID } from "node:crypto";

import { waAgentSessions, waConversations, waMessages } from "@wasfa/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WaAgentRepo } from "../../src/wa-agent/conversation/conversation.repo.js";
import {
  SessionService,
  type SessionConfig,
} from "../../src/wa-agent/conversation/session.service.js";
import { AdminTestContext } from "../support/admin-context.js";

import { Scenario, V2Runtime } from "./scenarios/harness.js";

import type { WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";

/*
 * Agent sessions (docs/WA-AGENT-RUNTIME.md §18): rollover, handles, burst sets, startNew and the v1 rule
 * that nothing is written while `waAgent.runtime.v2` is off. Real Postgres through the ingest path.
 */

const ctx = new AdminTestContext();
const HOUR_MS = 3_600_000;
const config: SessionConfig = { idleHours: 12, maxPages: 4 };

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

class Chat {
  readonly jid = `${randomUUID()}@s.whatsapp.net`;
  readonly repo = ctx.app.get(WaAgentRepo);
  readonly sessions = ctx.app.get(SessionService);
  conversationId = "";
  /** Message timestamps start 30 minutes ago so a burst never lies in the future. */
  base = Date.now() - 30 * 60_000;

  async send(
    over: Partial<WaAgentInbound> & {
      atMs?: number;
      now?: Date;
      v2?: boolean;
      cfg?: SessionConfig;
    },
  ): Promise<string> {
    const { atMs, now, v2 = true, cfg = config, ...entry } = over;
    const waMessageId = randomUUID();
    const result = await this.repo.ingest(
      {
        waMessageId,
        jid: this.jid,
        phone: null,
        direction: "in",
        kind: "text",
        text: "x",
        ts: this.base + (atMs ?? 0),
        ...entry,
      },
      new Date(Date.now() + 60_000),
      v2
        ? (tx, conversation, row) =>
            this.sessions.assignInTx(tx, conversation, row, now ?? new Date(), cfg)
        : undefined,
    );
    this.conversationId = result.conversation.id;
    const [row] = await ctx.owner.db
      .select({ id: waMessages.id })
      .from(waMessages)
      .where(eq(waMessages.waMessageId, waMessageId));
    if (row === undefined) throw new Error("row not stored");
    return row.id;
  }

  image(atMs: number, cfg?: SessionConfig): Promise<string> {
    return this.send({
      kind: "image",
      media: { key: `wa/2026/10/${randomUUID()}`, mime: "image/jpeg", bytes: 10 },
      atMs,
      ...(cfg === undefined ? {} : { cfg }),
    });
  }

  async row(id: string) {
    const [row] = await ctx.owner.db.select().from(waMessages).where(eq(waMessages.id, id));
    if (row === undefined) throw new Error("no row");
    return row;
  }

  async sessionRows() {
    return ctx.owner.db
      .select()
      .from(waAgentSessions)
      .where(eq(waAgentSessions.conversationId, this.conversationId))
      .orderBy(asc(waAgentSessions.startedAt), asc(waAgentSessions.id));
  }
}

describe("session assignment", () => {
  it("opens a session on the first inbound message", async () => {
    const chat = new Chat();
    const id = await chat.send({});
    const [session] = await chat.sessionRows();
    expect(session).toMatchObject({ isReturning: false, endedAt: null, endReason: null });
    expect((await chat.row(id)).sessionId).toBe(session?.id);
    const [conversation] = await ctx.owner.db
      .select()
      .from(waConversations)
      .where(eq(waConversations.id, chat.conversationId));
    expect(conversation?.sessionId).toBe(session?.id);
  });

  it("rolls over after 13 hours of silence and marks the new session as returning", async () => {
    const chat = new Chat();
    await chat.send({});
    const later = await chat.send({ now: new Date(Date.now() + 13 * HOUR_MS) });
    const sessions = await chat.sessionRows();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ endReason: "idle", isReturning: false });
    expect(sessions[0]?.endedAt).not.toBeNull();
    expect(sessions[1]).toMatchObject({ isReturning: true, endedAt: null });
    expect((await chat.row(later)).sessionId).toBe(sessions[1]?.id);
  });

  it("does not roll over before the idle limit", async () => {
    const chat = new Chat();
    await chat.send({});
    await chat.send({ now: new Date(Date.now() + 11 * HOUR_MS) });
    expect(await chat.sessionRows()).toHaveLength(1);
  });

  it("gives owner and queued reply rows the current session without rolling over", async () => {
    const chat = new Chat();
    await chat.send({});
    const far = new Date(Date.now() + 13 * HOUR_MS);
    const owner = await chat.send({ direction: "owner", now: far });
    const [session] = await chat.sessionRows();
    expect((await chat.row(owner)).sessionId).toBe(session?.id);
    const [out] = await ctx.owner.db
      .insert(waMessages)
      .values({
        conversationId: chat.conversationId,
        direction: "out",
        kind: "text",
        status: "queued",
      })
      .returning({ id: waMessages.id });
    await ctx.owner.db.transaction((tx) =>
      chat.sessions.stampOutbound(tx, chat.conversationId, [out?.id ?? ""]),
    );
    expect((await chat.row(out?.id ?? "")).sessionId).toBe(session?.id);
    expect(await chat.sessionRows()).toHaveLength(1);
  });

  it("numbers media 1..n per session and restarts at 1 in a new session", async () => {
    const chat = new Chat();
    const a = await chat.image(0);
    await chat.send({ atMs: 1_000 });
    const b = await chat.send({
      kind: "document",
      media: { key: `wa/2026/10/${randomUUID()}`, mime: "application/pdf", bytes: 10 },
      atMs: 2_000,
    });
    const c = await chat.image(3_000);
    expect(await Promise.all([a, b, c].map(async (id) => (await chat.row(id)).handle))).toEqual([
      1, 2, 3,
    ]);
    await chat.sessions.startNew(chat.conversationId, "command", new Date());
    const d = await chat.image(4_000);
    expect((await chat.row(d)).handle).toBe(1);
  });

  it("groups media sent within 120 seconds into one set and starts a new one after", async () => {
    const chat = new Chat();
    const ids = [await chat.image(0), await chat.image(60_000), await chat.image(150_000)];
    const later = await chat.image(150_000 + 3 * 60_000);
    const labels = await Promise.all(
      [...ids, later].map(async (id) => (await chat.row(id)).setLabel),
    );
    // 0 -> 60 s -> 150 s: each gap is within 120 s of the previous image; the 3 minute gap is not.
    expect(labels).toEqual(["A", "A", "A", "B"]);
  });

  it("starts a new set when a set already has rx.maxPages rows", async () => {
    const chat = new Chat();
    const cfg: SessionConfig = { idleHours: 12, maxPages: 2 };
    const ids = [
      await chat.image(0, cfg),
      await chat.image(10_000, cfg),
      await chat.image(20_000, cfg),
    ];
    const labels = await Promise.all(ids.map(async (id) => (await chat.row(id)).setLabel));
    expect(labels).toEqual(["A", "A", "B"]);
  });

  it("startNew keeps the old session's rows and opens a fresh, non-returning one", async () => {
    const chat = new Chat();
    const first = await chat.send({});
    const fresh = await chat.sessions.startNew(chat.conversationId, "command", new Date());
    const privacy = await chat.sessions.startNew(chat.conversationId, "privacy", new Date());
    const sessions = await chat.sessionRows();
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.endReason)).toEqual(["command", "privacy", null]);
    expect(sessions.map((s) => s.id)).toEqual([(await chat.row(first)).sessionId, fresh, privacy]);
    expect(sessions[2]?.isReturning).toBe(false);
    expect((await chat.row(first)).sessionId).toBe(sessions[0]?.id);
  });

  it("writes nothing to the session columns while v2 is off", async () => {
    const chat = new Chat();
    const id = await chat.send({
      v2: false,
      kind: "image",
      media: { key: `wa/2026/10/${randomUUID()}`, mime: "image/jpeg", bytes: 1 },
    });
    expect(await chat.row(id)).toMatchObject({ sessionId: null, handle: null, setLabel: null });
    expect(await chat.sessionRows()).toHaveLength(0);
  });
});

describe("session state and profile", () => {
  it("merges and clears state keys and keeps the profile across sessions", async () => {
    const chat = new Chat();
    await chat.send({});
    const [session] = await chat.sessionRows();
    const sessionId = session?.id ?? "";
    const until = new Date(Date.now() + 600_000).toISOString();
    await chat.sessions.setState(sessionId, { menu: { until } });
    await chat.sessions.setState(sessionId, { awaitingRx: { until } });
    expect(await chat.sessions.state(sessionId)).toEqual({
      menu: { until },
      awaitingRx: { until },
    });
    await chat.sessions.clearState(sessionId, "menu");
    expect(await chat.sessions.state(sessionId)).toEqual({ awaitingRx: { until } });

    await chat.sessions.setProfile(chat.conversationId, { lang: "en", preferredName: "Mona" });
    await chat.sessions.setProfile(chat.conversationId, { voice: "off" });
    await chat.sessions.startNew(chat.conversationId, "command", new Date());
    expect(await chat.sessions.profile(chat.conversationId)).toEqual({
      lang: "en",
      preferredName: "Mona",
      voice: "off",
    });
  });
});

describe("the model's context after a new session", () => {
  it("shows none of the earlier session's messages", async () => {
    const scenario = await Scenario.start(ctx, {
      model: () => "تمام",
      runtime: new V2Runtime(),
    });
    await scenario.inbound({ text: "عايز اسأل عن البنادول القديم" });
    await scenario.runTurns();
    expect(scenario.modelSaw(0)).toContain("البنادول القديم");

    await ctx.app.get(SessionService).startNew(scenario.conversationId, "command", new Date());
    await scenario.inbound({ text: "سؤال جديد خالص" });
    await scenario.runTurns();
    const seen = scenario.modelSaw(1);
    expect(seen).toContain("سؤال جديد خالص");
    expect(seen).not.toContain("البنادول القديم");
  });
});
