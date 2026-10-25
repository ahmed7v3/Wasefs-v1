import { describe, expect, it } from "vitest";

import { runPublishDue } from "../src/content/publish-due.job.js";

import type { PublishCandidate, PublishDueRepo } from "../src/content/publish-due.repo.js";

interface FakeItem extends PublishCandidate {
  scheduledAt: Date;
}

function fakeRepo(items: FakeItem[], publishedLog: Date[] = []) {
  const calls: string[] = [];
  const repo: PublishDueRepo = {
    dueScheduled: (now) =>
      Promise.resolve(
        items
          .filter((i) => i.status === "scheduled" && i.scheduledAt <= now)
          .map((i) => ({ id: i.id, scheduledAt: i.scheduledAt })),
      ),
    publishedSince: (since) => Promise.resolve(publishedLog.filter((d) => d >= since).length),
    loadCandidate: (id) => Promise.resolve(items.find((i) => i.id === id) ?? null),
    revertToDraft: (id) => {
      const item = items.find((i) => i.id === id);
      if (item) item.status = "draft";
      calls.push(`revert:${id}`);
      return Promise.resolve();
    },
    publish: (id, now, reason) => {
      const item = items.find((i) => i.id === id);
      if (item) item.status = "published";
      publishedLog.push(now);
      calls.push(`publish:${id}:${reason ?? ""}`);
      return Promise.resolve();
    },
  };
  return { repo, calls };
}

const item = (id: string, scheduledAt: string, over: Partial<FakeItem> = {}): FakeItem => ({
  id,
  status: "scheduled",
  type: "article",
  categoryRequiresReview: false,
  currentRevisionId: `r-${id}`,
  reviewedRevisionId: `r-${id}`,
  scheduledAt: new Date(scheduledAt),
  ...over,
});
const base = { cap: 2, timeZone: "UTC" };

describe("runPublishDue", () => {
  it("does nothing when nothing is due", async () => {
    const { repo, calls } = fakeRepo([item("a", "2030-01-02T00:00:00Z")]);
    const out = await runPublishDue({ repo, now: new Date("2030-01-01T10:00:00Z"), ...base });
    expect(out).toEqual({ published: [], reverted: [], deferred: 0 });
    expect(calls).toEqual([]);
  });

  it("publishes in scheduled order and rolls the rest over to the next day (cap 2)", async () => {
    const items = [
      item("c", "2030-01-01T09:03:00Z"),
      item("a", "2030-01-01T09:01:00Z"),
      item("b", "2030-01-01T09:02:00Z"),
    ];
    const { repo } = fakeRepo(items, []);
    const day1 = await runPublishDue({ repo, now: new Date("2030-01-01T10:00:00Z"), ...base });
    expect(day1.published).toEqual(["a", "b"]);
    expect(day1.deferred).toBe(1);
    // Same day, later run: the cap is used up.
    const later = await runPublishDue({ repo, now: new Date("2030-01-01T23:00:00Z"), ...base });
    expect(later.published).toEqual([]);
    expect(later.deferred).toBe(1);
    const day2 = await runPublishDue({ repo, now: new Date("2030-01-02T00:01:00Z"), ...base });
    expect(day2.published).toEqual(["c"]);
    expect(day2.deferred).toBe(0);
  });

  it("is idempotent: a second run publishes nothing twice", async () => {
    const { repo } = fakeRepo([item("a", "2030-01-01T09:00:00Z")]);
    const now = new Date("2030-01-01T09:01:00Z");
    expect((await runPublishDue({ repo, now, ...base, cap: 10 })).published).toEqual(["a"]);
    expect((await runPublishDue({ repo, now, ...base, cap: 10 })).published).toEqual([]);
  });

  it("skips an item that is no longer scheduled when re-read under the lock", async () => {
    const { repo, calls } = fakeRepo([item("a", "2030-01-01T09:00:00Z")]);
    const original = repo.loadCandidate;
    repo.loadCandidate = async (id) => {
      const row = await original(id);
      return row ? { ...row, status: "published" } : row;
    };
    const out = await runPublishDue({ repo, now: new Date("2030-01-01T09:01:00Z"), ...base });
    expect(out.published).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reverts to draft instead of publishing when the approval no longer matches", async () => {
    const guide = item("g", "2030-01-01T09:00:00Z", { type: "guide", reviewedRevisionId: "old" });
    const reviewedCategory = item("r", "2030-01-01T09:00:01Z", {
      categoryRequiresReview: true,
      reviewedRevisionId: null,
    });
    const free = item("f", "2030-01-01T09:00:02Z", { reviewedRevisionId: null });
    const { repo, calls } = fakeRepo([guide, reviewedCategory, free]);
    const out = await runPublishDue({
      repo,
      now: new Date("2030-01-01T09:01:00Z"),
      ...base,
      cap: 10,
    });
    expect(out.reverted).toEqual(["g", "r"]);
    expect(out.published).toEqual(["f"]);
    expect(calls).toEqual(["revert:g", "revert:r", "publish:f:"]);
  });

  it("notes a late publish in the reason", async () => {
    const { repo, calls } = fakeRepo([
      item("late", "2030-01-01T09:00:00Z"),
      item("ontime", "2030-01-01T09:59:00Z"),
    ]);
    await runPublishDue({ repo, now: new Date("2030-01-01T10:00:00Z"), ...base, cap: 10 });
    expect(calls).toEqual(["publish:late:late:3600s", "publish:ontime:"]);
  });
});
