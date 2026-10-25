import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentWorkflowService } from "../src/content/workflow.service.js";

import {
  NOW,
  actorOf,
  blockingGates,
  builtFixture,
  fakeRepo,
  fakeSettings,
  ids,
  makeItem,
  makeRevision,
} from "./support/content-fixtures.js";

import type { OutboxQueue } from "../src/common/outbox-queue.js";
import type { ContentRenderService } from "../src/content/content-render.service.js";
import type { ContentItemsRepo } from "../src/content/items.repo.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { ContentItem } from "@wasfa/db";
import type { ContentAction } from "@wasfa/shared/content/constants";
import type { ContentActionBody } from "@wasfa/shared/schemas/content";

/*
 * The workflow orchestration against a fake repository: which effects each action produces, who may
 * do it, and that nothing is written when it is refused. The state machine itself is tested in
 * packages/shared; these tests pin the wiring (gates, cap, four-eyes inputs, publish log, outbox).
 */

const writer = () => actorOf(ids.writer, ["content.read", "content.write"]);
const reviewer = (active = true) =>
  actorOf(ids.reviewer, ["content.read", "content.review"], active);
const publisher = () => actorOf(ids.other, ["content.read", "content.publish"]);
const manager = () => actorOf(ids.other, ["content.read", "content.manage"]);

function setup(item: ContentItem, options: { gates?: ReturnType<typeof builtFixture> } = {}) {
  const repo = fakeRepo(item, makeRevision());
  const render = { build: vi.fn(() => Promise.resolve(options.gates ?? builtFixture())) };
  const settings = fakeSettings();
  const outbox = { kick: vi.fn(() => Promise.resolve()) };
  const service = new ContentWorkflowService(
    repo as unknown as ContentItemsRepo,
    render as unknown as ContentRenderService,
    settings as unknown as SettingsService,
    outbox as unknown as OutboxQueue,
  );
  const act = (action: ContentAction, actor = writer(), body: ContentActionBody = {}) =>
    service.act(item.id, action, body, actor);
  return { repo, render, outbox, act };
}

const lastPatch = (repo: ReturnType<typeof fakeRepo>) =>
  repo.updateItem.mock.calls.at(-1)?.[1] as Partial<ContentItem>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("submit", () => {
  it("moves a draft into review and records who submitted what", async () => {
    const { act, repo } = setup(makeItem());
    expect(await act("submit")).toEqual({ from: "draft", to: "in_review" });
    expect(lastPatch(repo)).toMatchObject({
      status: "in_review",
      submittedRevisionId: ids.rev,
      submittedBy: ids.writer,
      lockVersion: 4,
    });
    expect(repo.insertPublishLog).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: "draft", toStatus: "in_review" }),
    );
  });

  it("is refused without content.write and writes nothing", async () => {
    const { act, repo } = setup(makeItem());
    await expect(act("submit", reviewer())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it("is refused for content that needs no review", async () => {
    const { act, repo } = setup(makeItem({ type: "page" }));
    await expect(act("submit")).rejects.toMatchObject({ code: "CONTENT_REVIEW_NOT_REQUIRED" });
    expect(repo.insertPublishLog).not.toHaveBeenCalled();
  });
});

describe("approve", () => {
  const inReview = () =>
    makeItem({ status: "in_review", submittedBy: ids.writer, submittedRevisionId: ids.rev });

  it("binds the approval to the current revision and schedules the next review", async () => {
    const { act, repo } = setup(inReview());
    await act("approve", reviewer(), { comment: "ok" });
    expect(lastPatch(repo)).toMatchObject({
      status: "approved",
      reviewedRevisionId: ids.rev,
      reviewedAt: NOW,
      nextReviewDue: new Date(NOW.getTime() + 365 * 86_400_000),
    });
    expect(repo.insertReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "approve", comment: "ok" }),
    );
  });

  it("refuses the submitter (four-eyes)", async () => {
    const item = makeItem({ status: "in_review", submittedBy: ids.reviewer });
    const { act, repo } = setup(item);
    await expect(act("approve", reviewer())).rejects.toMatchObject({ code: "CONTENT_FOUR_EYES" });
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it("refuses the author of the submitted revision even when someone else submitted", async () => {
    const item = makeItem({
      status: "in_review",
      submittedBy: ids.other,
      submittedRevisionId: ids.rev,
    });
    const { act, repo } = setup(item);
    repo.revisionAuthor.mockResolvedValue(ids.reviewer);
    await expect(act("approve", reviewer())).rejects.toMatchObject({ code: "CONTENT_FOUR_EYES" });
  });

  it("needs an active reviewer profile, not just the permission", async () => {
    const { act } = setup(inReview());
    await expect(act("approve", reviewer(false))).rejects.toMatchObject({
      code: "CONTENT_NOT_A_REVIEWER",
    });
  });

  it("creates the reviewer's revision first and approves THAT revision", async () => {
    const { act, repo } = setup(inReview());
    await act("approve", reviewer(), { edits: { bodyMd: "نص معدل" } });
    expect(repo.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "approve",
        bodyMd: "نص معدل",
        createdByUserId: ids.reviewer,
      }),
      NOW,
    );
    expect(repo.insertRevision.mock.invocationCallOrder[0]).toBeLessThan(
      repo.updateItem.mock.invocationCallOrder[0] ?? 0,
    );
    const patch = lastPatch(repo);
    expect(patch).toMatchObject({
      status: "approved",
      currentRevisionId: ids.rev2,
      reviewedRevisionId: ids.rev2,
    });
  });
});

describe("request_changes", () => {
  const inReview = () => makeItem({ status: "in_review", submittedBy: ids.writer });

  it("requires a comment", async () => {
    const { act } = setup(inReview());
    await expect(act("request_changes", reviewer())).rejects.toMatchObject({
      code: "CONTENT_COMMENT_REQUIRED",
    });
  });

  it("sends the item back to draft and keeps the comment", async () => {
    const { act, repo } = setup(inReview());
    await act("request_changes", reviewer(), { comment: "fix the dosing" });
    expect(lastPatch(repo)).toMatchObject({ status: "draft" });
    expect(repo.insertReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request_changes" }),
    );
  });
});

describe("schedule and publish", () => {
  const approved = () => makeItem({ status: "approved", reviewedRevisionId: ids.rev });

  it("refuses a time in the past", async () => {
    const { act } = setup(approved());
    await expect(
      act("schedule", publisher(), { at: new Date(NOW.getTime() - 3_600_000).toISOString() }),
    ).rejects.toMatchObject({ code: "CONTENT_SCHEDULE_IN_PAST" });
  });

  it("stores the schedule and the fresh gates", async () => {
    const at = new Date(NOW.getTime() + 3_600_000);
    const { act, repo } = setup(approved());
    await act("schedule", publisher(), { at: at.toISOString() });
    expect(lastPatch(repo)).toMatchObject({ status: "scheduled", scheduledAt: at });
    expect(repo.updateRevisionQuality).toHaveBeenCalled();
  });

  it("recomputes the gates and refuses with the blocking ids", async () => {
    const { act, repo, render } = setup(approved(), { gates: builtFixture(blockingGates) });
    await expect(act("publish", publisher())).rejects.toMatchObject({
      code: "CONTENT_GATES_BLOCK",
      details: { gates: ["min_words"] },
    });
    expect(render.build).toHaveBeenCalledTimes(1);
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("refuses a manual publish beyond the daily cap", async () => {
    const { act, repo } = setup(approved());
    repo.countPublishedSince.mockResolvedValue(25);
    await expect(act("publish", publisher())).rejects.toMatchObject({
      code: "CONTENT_PUBLISH_CAP",
    });
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("publishes through the shared helper and wakes the worker", async () => {
    const { act, repo, outbox } = setup(approved());
    expect(await act("publish", publisher())).toEqual({ from: "approved", to: "published" });
    expect(repo.publish).toHaveBeenCalledWith({
      itemId: ids.item,
      actor: { type: "user", id: ids.other, name: "Tester" },
      now: NOW,
    });
    expect(outbox.kick).toHaveBeenCalledTimes(1);
  });

  it("refuses to publish when the approval is not of the current revision", async () => {
    const item = makeItem({ status: "approved", reviewedRevisionId: ids.rev2 });
    const { act } = setup(item);
    await expect(act("publish", publisher())).rejects.toMatchObject({
      code: "CONTENT_NOT_APPROVED",
    });
  });
});

describe("unpublish, archive, unarchive", () => {
  it("unpublish uses the shared helper and kicks the outbox", async () => {
    const item = makeItem({ status: "published", publishedRevisionId: ids.rev });
    const { act, repo, outbox } = setup(item);
    await act("unpublish", publisher());
    expect(repo.unpublish).toHaveBeenCalledTimes(1);
    expect(outbox.kick).toHaveBeenCalled();
  });

  it("archive with a redirect records it and tells the worker the old path moved", async () => {
    const item = makeItem({
      status: "published",
      publishedRevisionId: ids.rev,
      firstPublishedAt: NOW,
    });
    const { act, repo, outbox } = setup(item);
    await act("archive", manager(), { redirectTo: "/blog/other" });
    expect(lastPatch(repo)).toMatchObject({
      status: "archived",
      publishedRevisionId: null,
      archivedRedirectTo: "/blog/other",
      archivedAt: NOW,
    });
    expect(repo.upsertRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPath: "/blog/my-article",
        toPath: "/blog/other",
        reason: "archived",
      }),
    );
    expect(repo.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "archived", oldPaths: ["/blog/my-article"] }),
      expect.any(String),
    );
    expect(outbox.kick).toHaveBeenCalled();
  });

  it("archive without a redirect writes none and an unpublished item emits nothing", async () => {
    const { act, repo } = setup(makeItem());
    await act("archive", manager());
    expect(repo.upsertRedirect).not.toHaveBeenCalled();
    expect(repo.emit).not.toHaveBeenCalled();
    expect(lastPatch(repo)).toMatchObject({ status: "archived", archivedRedirectTo: null });
  });

  it("archive refuses a redirect to its own path", async () => {
    const { act } = setup(makeItem());
    await expect(
      act("archive", manager(), { redirectTo: "/blog/my-article" }),
    ).rejects.toMatchObject({
      code: "CONTENT_REDIRECT_INVALID",
    });
  });

  it("unarchive drops the archive redirect and returns to draft", async () => {
    const { act, repo } = setup(makeItem({ status: "archived" }));
    repo.deleteArchivedRedirect.mockResolvedValue(true);
    await act("unarchive", manager());
    expect(lastPatch(repo)).toMatchObject({ status: "draft", archivedAt: null });
    expect(repo.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "redirects" }),
      expect.any(String),
    );
  });
});

describe("concurrency", () => {
  it("answers CONTENT_CONFLICT when the caller's lockVersion is stale", async () => {
    const { act } = setup(makeItem());
    await expect(act("submit", writer(), { lockVersion: 1 })).rejects.toMatchObject({
      code: "CONTENT_CONFLICT",
      details: { currentLockVersion: 3 },
    });
  });

  it("answers CONTENT_CONFLICT when the item changed between the read and the lock", async () => {
    const item = makeItem();
    const { act, repo } = setup(item);
    repo.lockItem.mockResolvedValue(makeItem({ lockVersion: 4 }));
    await expect(act("submit")).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    expect(repo.updateItem).not.toHaveBeenCalled();
  });
});
