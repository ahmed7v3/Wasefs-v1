import { randomUUID } from "node:crypto";

import {
  contentItems,
  contentPublishLog,
  contentRevisions,
  createDb,
  drainOutbox,
  outbox,
  seedDefaults,
  siteSettings,
} from "@wasfa/db";
import { REVALIDATE_HEADER, verifyRevalidation } from "@wasfa/shared/content/revalidate";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { contentChangeHandler } from "../src/content/change-handler.js";
import { publishDueJob } from "../src/content/publish-due.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/*
 * Scheduled publishing and the `content.changed` outbox topic against a real database, as the
 * restricted `wasfa_api` role the worker runs as. Needs Docker (Testcontainers).
 */

const logger = pino({ level: "silent" });
const SECRET = "r".repeat(40);
let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 2 });
  await seedDefaults(owner.db);
}, 180_000);

afterAll(async () => {
  await owner?.close();
  await worker?.close();
  await postgres?.stop();
});

async function setCap(maxPublishesPerDay: number): Promise<void> {
  const value = { maxPublishesPerDay, timeZone: "UTC" };
  await owner.db
    .insert(siteSettings)
    .values({ key: "content", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
}

/** A scheduled article (no category: review required) whose approval matches its revision. */
async function scheduledItem(scheduledAt: Date, approved = true): Promise<string> {
  const id = randomUUID();
  const revisionId = randomUUID();
  await owner.db.insert(contentItems).values({
    id,
    type: "article",
    locale: "ar",
    translationGroupId: randomUUID(),
    slug: `item-${id.slice(0, 8)}`,
    status: "scheduled",
    title: "t",
    scheduledAt,
  });
  await owner.db.insert(contentRevisions).values({
    id: revisionId,
    itemId: id,
    number: 1,
    kind: "create",
    title: "t",
    bodyMd: "body",
    createdByName: "test",
  });
  await owner.db
    .update(contentItems)
    .set({ currentRevisionId: revisionId, reviewedRevisionId: approved ? revisionId : null })
    .where(eq(contentItems.id, id));
  return id;
}

const context = () => ({ db: worker.db, logger, payments: undefined });
const statusOf = async (id: string) =>
  (await owner.db.select().from(contentItems).where(eq(contentItems.id, id)))[0]?.status;

describe("content.publish-due", () => {
  it("publishes due items with an outbox event and a publish log row, once", async () => {
    await setCap(100);
    const id = await scheduledItem(new Date(Date.now() - 60_000));
    const future = await scheduledItem(new Date(Date.now() + 3_600_000));
    await publishDueJob({}, context());
    await publishDueJob({}, context());
    expect(await statusOf(id)).toBe("published");
    expect(await statusOf(future)).toBe("scheduled");
    const log = await owner.db
      .select()
      .from(contentPublishLog)
      .where(eq(contentPublishLog.itemId, id));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorType: "system", actorName: "scheduler" });
    const events = (await owner.db.select().from(outbox)).filter(
      (row) =>
        row.topic === "content.changed" && (row.payload as { itemId?: string }).itemId === id,
    );
    expect(events).toHaveLength(1);
  });

  it("respects the daily cap and leaves the rest scheduled", async () => {
    const before = (await owner.db.select().from(contentPublishLog)).filter(
      (row) => row.toStatus === "published",
    ).length;
    await setCap(before + 1);
    const ids = [
      await scheduledItem(new Date(Date.now() - 120_000)),
      await scheduledItem(new Date(Date.now() - 60_000)),
    ];
    await publishDueJob({}, context());
    expect([await statusOf(ids[0] ?? ""), await statusOf(ids[1] ?? "")]).toEqual([
      "published",
      "scheduled",
    ]);
  });

  it("reverts an item whose approval is missing to draft and logs why", async () => {
    await setCap(1_000);
    const id = await scheduledItem(new Date(Date.now() - 60_000), false);
    await publishDueJob({}, context());
    expect(await statusOf(id)).toBe("draft");
    const [log] = await owner.db
      .select()
      .from(contentPublishLog)
      .where(eq(contentPublishLog.itemId, id));
    expect(log?.reason).toBe("approval_missing_at_publish_time");
  });
});

describe("content.changed outbox topic", () => {
  it("drains through the handler: signed purge call, entry processed", async () => {
    const id = await scheduledItem(new Date(Date.now() - 60_000));
    await setCap(1_000);
    await publishDueJob({}, context());
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const handler = contentChangeHandler({
      logger,
      webInternalUrl: "http://web:3000",
      revalidateSecret: SECRET,
      webOrigin: "https://wasfa.online",
      indexNowSettings: () => Promise.resolve({ enabled: false, key: null }),
      enqueueIndexNow: () => Promise.resolve(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await drainOutbox(worker.db, { "content.changed": handler }, new Date(), 100);
    expect(result.failed).toBe(0);
    expect(fetchImpl).toHaveBeenCalled();
    // The outbox also holds the events of the earlier tests in this file: find this item's call.
    const calls = fetchImpl.mock.calls as [
      string,
      { body: string; headers: Record<string, string> },
    ][];
    const call = calls.find(([, candidate]) => candidate.body.includes(`content:item:${id}`));
    if (call === undefined) throw new Error("no purge call for the item");
    const init = call[1];
    const parsed = JSON.parse(init.body) as { tags: string[]; timestamp: number };
    expect(parsed.tags).toContain(`content:item:${id}`);
    expect(
      verifyRevalidation({
        secret: SECRET,
        signature: init.headers[REVALIDATE_HEADER] ?? "",
        timestamp: parsed.timestamp,
        body: init.body,
        now: Math.floor(Date.now() / 1000),
        windowSeconds: 300,
      }),
    ).toEqual({ ok: true });
  });
});
