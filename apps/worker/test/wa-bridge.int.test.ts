import { randomBytes } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, runMigrations, waSessions } from "@wasfa/db";
import { WA_REPLY_STREAM } from "@wasfa/shared/schemas/phone";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { clearSession, usePostgresAuthState } from "../src/wa-bridge/auth-state.js";
import {
  DAILY_REPLY_CAP,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  MIN_SPACING_MS,
  ReplyGuard,
  isAllowedReplyText,
} from "../src/wa-bridge/guard.js";
import { processReplyRequest, runReplyLoop, type ReplySocket } from "../src/wa-bridge/replies.js";

import { startRedis, type TestRedis } from "./support/redis.js";

const JID = "201012345678@s.whatsapp.net";
const logger = pino({ level: "silent" });

let redisInfra: TestRedis;
let redis: Redis;
let postgres: StartedPostgreSqlContainer;
let handle: ReturnType<typeof createDb>;

beforeAll(async () => {
  const [redisStarted, postgresStarted] = await Promise.all([
    startRedis(),
    new PostgreSqlContainer("postgres:18-alpine").start(),
  ]);
  redisInfra = redisStarted;
  postgres = postgresStarted;
  redis = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
  handle = createDb({ url: postgres.getConnectionUri(), max: 2 });
  await runMigrations(handle.db);
});

afterAll(async () => {
  await redis?.quit();
  await handle?.close();
  await Promise.all([redisInfra?.stop(), postgres?.stop()]);
});

beforeEach(async () => {
  await redis.flushall();
});

describe("ReplyGuard", () => {
  it("never replies to a chat that did not message first", async () => {
    const guard = new ReplyGuard(redis);
    const text = "تم التحقق ✅";
    expect(await guard.authorize({ jid: JID, inboundId: "A", text })).toEqual({
      ok: false,
      reason: "no_recent_inbound",
    });

    await guard.noteInbound(JID, "A");
    expect((await guard.authorize({ jid: JID, inboundId: "A", text })).ok).toBe(true);
    // A message id we never received is not a reason to write either.
    expect(await guard.authorize({ jid: JID, inboundId: "B", text })).toMatchObject({
      reason: "no_recent_inbound",
    });
    // Nor is another chat.
    expect(
      await guard.authorize({ jid: "201099999999@s.whatsapp.net", inboundId: "A", text }),
    ).toMatchObject({ reason: "no_recent_inbound" });
  });

  it("allows one reply per inbound message", async () => {
    const guard = new ReplyGuard(redis);
    const text = "تم التحقق ✅";
    await guard.noteInbound(JID, "A");
    expect((await guard.authorize({ jid: JID, inboundId: "A", text })).ok).toBe(true);
    expect(await guard.authorize({ jid: JID, inboundId: "A", text })).toEqual({
      ok: false,
      reason: "already_replied",
    });
  });

  it("refuses groups, statuses, links and long text", async () => {
    const guard = new ReplyGuard(redis);
    await guard.noteInbound("120363000000@g.us", "A");
    expect(
      await guard.authorize({ jid: "120363000000@g.us", inboundId: "A", text: "تم التحقق ✅" }),
    ).toMatchObject({ reason: "not_direct" });
    expect(
      await guard.authorize({ jid: "status@broadcast", inboundId: "A", text: "تم التحقق ✅" }),
    ).toMatchObject({ reason: "not_direct" });

    await guard.noteInbound(JID, "A");
    for (const text of [
      "see https://wasfa.online",
      "wasfa.com",
      "www.x",
      "write @me",
      "",
      "x".repeat(61),
    ]) {
      expect(await guard.authorize({ jid: JID, inboundId: "A", text })).toMatchObject({
        reason: "text_not_allowed",
      });
    }
    expect(isAllowedReplyText("الرمز غير صحيح أو منتهي الصلاحية")).toBe(true);
  });

  it("waits 2 to 6 seconds, and at least 3 seconds after the previous reply", async () => {
    const guard = new ReplyGuard(redis);
    const text = "تم التحقق ✅";
    const delays: number[] = [];
    for (let i = 0; i < 20; i++) {
      await guard.noteInbound(JID, `m${i}`);
      const decision = await guard.authorize({ jid: JID, inboundId: `m${i}`, text });
      if (decision.ok) delays.push(decision.delayMs);
    }
    expect(delays).toHaveLength(20);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(MIN_DELAY_MS);
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_DELAY_MS);

    // Just sent one: the next delay covers the rest of the 3 s spacing even with the smallest jitter.
    const now = Date.now();
    const spaced = new ReplyGuard(
      redis,
      () => now,
      () => 0,
    );
    await spaced.recordSent();
    await spaced.noteInbound(JID, "late");
    const next = await spaced.authorize({ jid: JID, inboundId: "late", text });
    expect(next).toEqual({ ok: true, delayMs: Math.max(MIN_DELAY_MS, MIN_SPACING_MS) });
  });

  it("stays silent after 300 replies in a UTC day", async () => {
    const guard = new ReplyGuard(redis);
    for (let i = 0; i < DAILY_REPLY_CAP; i++) await guard.recordSent();
    await guard.noteInbound(JID, "A");
    expect(await guard.authorize({ jid: JID, inboundId: "A", text: "تم التحقق ✅" })).toEqual({
      ok: false,
      reason: "daily_cap",
    });
  });

  it("keeps jids and phone numbers out of Redis keys", async () => {
    const guard = new ReplyGuard(redis);
    await guard.noteInbound(JID, "A");
    await guard.authorize({ jid: JID, inboundId: "A", text: "تم التحقق ✅" });
    const keys = (await redis.keys("wa:*")).join("\n");
    expect(keys).not.toContain("201012345678");
  });
});

function fakeSocket(connected = true) {
  const calls: string[] = [];
  const socket: ReplySocket = {
    isConnected: () => connected,
    composing: (jid) => {
      calls.push(`composing:${jid}`);
      return Promise.resolve();
    },
    paused: (jid) => {
      calls.push(`paused:${jid}`);
      return Promise.resolve();
    },
    sendText: (jid, text) => {
      calls.push(`send:${jid}:${text}`);
      return Promise.resolve();
    },
  };
  return { socket, calls };
}

describe("processReplyRequest", () => {
  it("types, waits, sends the fixed sentence once, and counts it", async () => {
    const guard = new ReplyGuard(redis);
    const { socket, calls } = fakeSocket();
    const slept: number[] = [];
    const deps = {
      guard,
      socket,
      logger,
      sleep: (ms: number) => {
        slept.push(ms);
        return Promise.resolve();
      },
    };
    await guard.noteInbound(JID, "A");
    const request = { inboundId: "A", jid: JID, outcome: "verified" };

    expect(await processReplyRequest(request, deps)).toBe("sent");
    expect(calls).toEqual([`composing:${JID}`, `send:${JID}:تم التحقق ✅`, `paused:${JID}`]);
    expect(slept[0]).toBeGreaterThanOrEqual(MIN_DELAY_MS);
    expect(await redis.get("wa:last-sent")).not.toBeNull();

    // A replayed request is not answered twice.
    expect(await processReplyRequest(request, deps)).toBe("already_replied");
    expect(calls).toHaveLength(3);
  });

  it("uses the fixed 'invalid' sentence and ignores malformed or unsolicited requests", async () => {
    const guard = new ReplyGuard(redis);
    const { socket, calls } = fakeSocket();
    const deps = { guard, socket, logger, sleep: () => Promise.resolve() };
    await guard.noteInbound(JID, "A");
    expect(await processReplyRequest({ inboundId: "A", jid: JID, outcome: "invalid" }, deps)).toBe(
      "sent",
    );
    expect(calls).toContain(`send:${JID}:الرمز غير صحيح أو منتهي الصلاحية`);

    // The api cannot choose the text, and cannot make us write to a chat that never wrote to us.
    expect(
      await processReplyRequest(
        { inboundId: "Z", jid: JID, outcome: "verified", text: "hi" },
        deps,
      ),
    ).toBe("no_recent_inbound");
    expect(
      await processReplyRequest({ inboundId: "Z", jid: JID, outcome: "free text" }, deps),
    ).toBe("invalid");
    expect(await processReplyRequest(null, deps)).toBe("invalid");
    expect(calls.filter((call) => call.startsWith("send:"))).toHaveLength(1);
  });

  it("stays silent while the socket is not connected", async () => {
    const guard = new ReplyGuard(redis);
    const { socket, calls } = fakeSocket(false);
    await guard.noteInbound(JID, "A");
    const result = await processReplyRequest(
      { inboundId: "A", jid: JID, outcome: "verified" },
      { guard, socket, logger, sleep: () => Promise.resolve() },
    );
    expect(result).toBe("not_connected");
    expect(calls).toEqual([]);
  });
});

describe("runReplyLoop", () => {
  it("answers entries of wa:replies and acknowledges them, malformed ones included", async () => {
    const guard = new ReplyGuard(redis);
    const { socket, calls } = fakeSocket();
    const controller = new AbortController();
    const consumer = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
    await guard.noteInbound(JID, "A");

    const loop = runReplyLoop({
      redis: consumer,
      consumer: "test",
      deps: { guard, socket, logger, sleep: () => Promise.resolve() },
      signal: controller.signal,
    });
    // Let the group be created before adding entries ("$" only delivers newer entries).
    await new Promise((resolve) => setTimeout(resolve, 300));
    await redis.xadd(WA_REPLY_STREAM, "*", "data", "not json");
    await redis.xadd(
      WA_REPLY_STREAM,
      "*",
      "data",
      JSON.stringify({ inboundId: "A", jid: JID, outcome: "verified" }),
    );

    const deadline = Date.now() + 10_000;
    while (!calls.some((call) => call.startsWith("send:")) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(calls.filter((call) => call.startsWith("send:"))).toHaveLength(1);
    const pending = await redis.xpending(WA_REPLY_STREAM, "bridge");
    expect(pending[0]).toBe(0);

    controller.abort();
    consumer.disconnect();
    await loop;
  });
});

describe("Postgres auth state", () => {
  const key = randomBytes(32);

  it("starts empty, then restores credentials and keys after a restart", async () => {
    const first = await usePostgresAuthState(handle.db, key, "restart");
    expect(first.existed).toBe(false);
    await first.saveCreds();
    await first.state.keys.set({
      "pre-key": {
        "17": { public: new Uint8Array([1, 2, 3]), private: new Uint8Array([4, 5, 6]) },
      },
      session: { "1234.0": new Uint8Array([9, 9]) },
    });

    const second = await usePostgresAuthState(handle.db, key, "restart");
    expect(second.existed).toBe(true);
    expect(second.state.creds.registrationId).toBe(first.state.creds.registrationId);
    expect(Buffer.from(second.state.creds.noiseKey.private)).toEqual(
      Buffer.from(first.state.creds.noiseKey.private),
    );
    const preKeys = await second.state.keys.get("pre-key", ["17", "99"]);
    expect(Object.keys(preKeys)).toEqual(["17"]);
    expect(Array.from(preKeys["17"]?.private ?? [])).toEqual([4, 5, 6]);
    const sessions = await second.state.keys.get("session", ["1234.0"]);
    expect(Array.from(sessions["1234.0"] ?? [])).toEqual([9, 9]);
  });

  it("deletes a key when Baileys sets it to null", async () => {
    const auth = await usePostgresAuthState(handle.db, key, "delete");
    await auth.state.keys.set({ session: { a: new Uint8Array([1]) } });
    await auth.state.keys.set({ session: { a: null } });
    expect(await auth.state.keys.get("session", ["a"])).toEqual({});
  });

  it("stores only ciphertext, bound to its own row", async () => {
    const auth = await usePostgresAuthState(handle.db, key, "sealed");
    await auth.saveCreds();
    await auth.state.keys.set({
      session: { a: new Uint8Array([1, 2]), b: new Uint8Array([3, 4]) },
    });

    const rows = await handle.db.select().from(waSessions).where(eq(waSessions.session, "sealed"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.value.startsWith("v2.")).toBe(true);
      expect(row.value).not.toContain("noiseKey");
      expect(row.value).not.toContain("registrationId");
    }

    // Swap two rows: the AAD (session + key) no longer matches, so neither decrypts.
    const a = rows.find((row) => row.key === "session:a");
    const b = rows.find((row) => row.key === "session:b");
    if (!a || !b) throw new Error("rows missing");
    await handle.db.update(waSessions).set({ value: b.value }).where(eq(waSessions.key, a.key));
    await expect(auth.state.keys.get("session", ["a"])).rejects.toThrow();
  });

  it("refuses to start from scratch when stored credentials cannot be decrypted", async () => {
    const auth = await usePostgresAuthState(handle.db, key, "wrongkey");
    await auth.saveCreds();
    await expect(usePostgresAuthState(handle.db, randomBytes(32), "wrongkey")).rejects.toThrow();
  });

  it("keeps sessions apart and forgets one on request", async () => {
    const one = await usePostgresAuthState(handle.db, key, "one");
    await one.saveCreds();
    await one.state.keys.set({ session: { a: new Uint8Array([1]) } });
    const other = await usePostgresAuthState(handle.db, key, "other");
    expect(other.existed).toBe(false);

    expect(await clearSession(handle.db, "one")).toBeGreaterThanOrEqual(2);
    expect((await usePostgresAuthState(handle.db, key, "one")).existed).toBe(false);
  });
});
