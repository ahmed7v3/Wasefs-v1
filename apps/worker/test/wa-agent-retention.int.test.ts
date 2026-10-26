import { createDb, waConversations, waMessages } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { waAgentRetentionJob } from "../src/jobs/wa-agent.retention.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

import type { ObjectStore } from "../src/storage/object-store.js";

/*
 * `wa-agent.retention`: transcripts and their media go after `waAgent.retentionDays` (default 90),
 * empty old conversations with them. Real Postgres as the restricted `wasfa_api` role.
 */

const logger = pino({ level: "silent" });
let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 2 });
}, 180_000);

afterAll(async () => {
  await Promise.all([owner.close(), worker.close()]);
  await postgres.stop();
});

const DAY = 86_400_000;

describe("waAgentRetentionJob", () => {
  it("deletes old messages and their media, keeps recent ones, drops emptied old conversations", async () => {
    const now = new Date("2026-10-26T04:50:00Z");
    const old = new Date(now.getTime() - 91 * DAY);
    const recent = new Date(now.getTime() - 10 * DAY);
    const [busy, quiet, fresh] = await owner.db
      .insert(waConversations)
      .values([
        { jid: "1@s.whatsapp.net", updatedAt: old },
        { jid: "2@s.whatsapp.net", updatedAt: old },
        { jid: "3@s.whatsapp.net", updatedAt: recent },
      ])
      .returning();
    if (!busy || !quiet || !fresh) throw new Error("fixtures");
    await owner.db.insert(waMessages).values([
      {
        conversationId: busy.id,
        direction: "in",
        kind: "image",
        status: "received",
        mediaKey: "wa/2026/07/old-image",
        createdAt: old,
      },
      {
        conversationId: busy.id,
        direction: "in",
        kind: "text",
        status: "received",
        text: "new",
        createdAt: recent,
      },
      {
        conversationId: quiet.id,
        direction: "in",
        kind: "text",
        status: "received",
        text: "old",
        createdAt: old,
      },
    ]);

    const removed: string[] = [];
    const storage = {
      remove: (key: string) => {
        removed.push(key);
        return Promise.resolve();
      },
    } as unknown as ObjectStore;
    await waAgentRetentionJob({}, { db: worker.db, logger, storage }, now);

    expect(removed).toEqual(["wa/2026/07/old-image"]);
    const left = await owner.db.select().from(waMessages);
    expect(left.map((row) => row.text)).toEqual(["new"]);
    const conversations = await owner.db.select({ jid: waConversations.jid }).from(waConversations);
    // `busy` still has a message, `fresh` is recent; only the emptied old one is gone.
    expect(conversations.map((row) => row.jid).sort()).toEqual([
      "1@s.whatsapp.net",
      "3@s.whatsapp.net",
    ]);
    expect(
      await owner.db.select().from(waConversations).where(eq(waConversations.id, quiet.id)),
    ).toEqual([]);
  });

  it("keeps a row whose media cannot be deleted because storage is not configured", async () => {
    const now = new Date("2026-10-26T04:50:00Z");
    const old = new Date(now.getTime() - 200 * DAY);
    const [conversation] = await owner.db
      .insert(waConversations)
      .values({ jid: "9@s.whatsapp.net", updatedAt: old })
      .returning();
    if (!conversation) throw new Error("fixture");
    await owner.db.insert(waMessages).values({
      conversationId: conversation.id,
      direction: "in",
      kind: "audio",
      status: "received",
      mediaKey: "wa/2026/01/voice",
      createdAt: old,
    });
    await waAgentRetentionJob({}, { db: worker.db, logger, storage: undefined }, now);
    const rows = await owner.db
      .select()
      .from(waMessages)
      .where(eq(waMessages.conversationId, conversation.id));
    expect(rows).toHaveLength(1);
  });
});
