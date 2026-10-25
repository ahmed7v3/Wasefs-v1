import { createContentItemSchema } from "@wasfa/shared/schemas/content";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentItemsService, pickFreeSlug } from "../src/content/items.service.js";

import {
  NOW,
  actorOf,
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

const editor = () => actorOf(ids.writer, ["content.read", "content.write"]);

function setup(item: ContentItem, settingOverrides: Record<string, unknown> = {}) {
  const repo = fakeRepo(item, makeRevision());
  const render = { build: vi.fn(() => Promise.resolve(builtFixture())) };
  const outbox = { kick: vi.fn(() => Promise.resolve()) };
  const service = new ContentItemsService(
    repo as unknown as ContentItemsRepo,
    render as unknown as ContentRenderService,
    fakeSettings(settingOverrides) as unknown as SettingsService,
    outbox as unknown as OutboxQueue,
  );
  return { service, repo, render, outbox };
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

describe("pickFreeSlug", () => {
  it("keeps a free slug and numbers a taken one from -2", () => {
    expect(pickFreeSlug("flu", new Set())).toBe("flu");
    expect(pickFreeSlug("flu", new Set(["flu"]))).toBe("flu-2");
    expect(pickFreeSlug("flu", new Set(["flu", "flu-2", "flu-3"]))).toBe("flu-4");
  });

  it("stays within the slug limit when numbering a long base", () => {
    const base = "a".repeat(120);
    const slug = pickFreeSlug(base, new Set([base]));
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-2")).toBe(true);
  });
});

describe("create", () => {
  const input = createContentItemSchema.parse({
    type: "article",
    locale: "ar",
    payload: { title: "Flu in winter", bodyMd: "body" },
    meta: {},
  });

  it("derives the slug from the title and numbers it when taken", async () => {
    const { service, repo } = setup(makeItem());
    repo.slugsLike.mockResolvedValue(["flu-in-winter", "flu-in-winter-2"]);
    await service.create(editor(), input);
    expect(repo.insertItem).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "flu-in-winter-3", type: "article", locale: "ar" }),
      NOW,
    );
    expect(repo.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "create", number: 2 }),
      NOW,
    );
    // Created as a draft with the new revision as the current one.
    expect(lastPatch(repo)).toMatchObject({ status: "draft", currentRevisionId: ids.rev2 });
  });

  it("refuses an explicit slug that is taken", async () => {
    const { service, repo } = setup(makeItem());
    repo.slugTaken.mockResolvedValue(true);
    await expect(
      service.create(editor(), { ...input, meta: { ...input.meta, slug: "taken" } }),
    ).rejects.toMatchObject({ code: "CONTENT_SLUG_TAKEN" });
    expect(repo.insertItem).not.toHaveBeenCalled();
  });

  it("joins the source's translation group only for a new locale", async () => {
    const { service, repo } = setup(makeItem());
    await service.create(editor(), { ...input, locale: "en", translationOf: ids.item });
    expect(repo.insertItem).toHaveBeenCalledWith(
      expect.objectContaining({ translationGroupId: ids.group }),
      NOW,
    );

    repo.insertItem.mockClear();
    await service.create(editor(), { ...input, locale: "ar", translationOf: ids.item });
    const used = (repo.insertItem.mock.calls[0] as unknown as [{ translationGroupId: string }])[0];
    expect(used.translationGroupId).not.toBe(ids.group);
  });
});

describe("update", () => {
  it("answers CONTENT_CONFLICT with the current version when the editor is stale", async () => {
    const { service, repo } = setup(makeItem({ lockVersion: 5 }));
    await expect(
      service.update(editor(), ids.item, { lockVersion: 4, payload: { title: "x" } }),
    ).rejects.toMatchObject({
      code: "CONTENT_CONFLICT",
      details: { currentLockVersion: 5, currentRevisionId: ids.rev },
    });
    expect(repo.transaction).not.toHaveBeenCalled();
  });

  it("a meta-only change makes no revision but still bumps the lock version", async () => {
    const { service, repo } = setup(makeItem());
    await service.update(editor(), ids.item, {
      lockVersion: 3,
      meta: { seo: { description: "new description" } },
    });
    expect(repo.insertRevision).not.toHaveBeenCalled();
    expect(lastPatch(repo)).toMatchObject({ lockVersion: 4, updatedAt: NOW });
    expect(lastPatch(repo).currentRevisionId).toBeUndefined();
    // The stored gates follow the metadata they were computed from.
    expect(repo.updateRevisionQuality).toHaveBeenCalled();
  });

  it("an unchanged payload is not a revision", async () => {
    const { service, repo } = setup(makeItem());
    await service.update(editor(), ids.item, { lockVersion: 3, payload: { title: "عنوان" } });
    expect(repo.insertRevision).not.toHaveBeenCalled();
  });

  it("a payload change adds a revision, returns the item to draft and leaves the live pointer", async () => {
    const item = makeItem({
      status: "approved",
      reviewedRevisionId: ids.rev,
      publishedRevisionId: ids.rev,
      scheduledAt: null,
    });
    const { service, repo } = setup(item);
    await service.update(editor(), ids.item, {
      lockVersion: 3,
      payload: { bodyMd: "completely new body" },
      note: "reworded",
    });
    expect(repo.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "save", bodyMd: "completely new body", note: "reworded" }),
      NOW,
    );
    const patch = lastPatch(repo);
    expect(patch).toMatchObject({ status: "draft", currentRevisionId: ids.rev2, lockVersion: 4 });
    expect("publishedRevisionId" in patch).toBe(false);
    // The author's own autosave is spent by the explicit save.
    expect(repo.deleteAutosave).toHaveBeenCalledWith(ids.item, ids.writer);
    expect(repo.insertPublishLog).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: "approved", toStatus: "draft" }),
    );
  });

  it("clears a pending schedule when the content changes", async () => {
    const item = makeItem({ status: "scheduled", scheduledAt: NOW });
    const { service, repo } = setup(item);
    await service.update(editor(), ids.item, { lockVersion: 3, payload: { title: "new" } });
    expect(lastPatch(repo)).toMatchObject({ status: "draft", scheduledAt: null });
  });

  it("changing the slug of a live item writes a redirect and a moved event", async () => {
    const item = makeItem({
      status: "published",
      publishedRevisionId: ids.rev,
      firstPublishedAt: NOW,
    });
    const { service, repo, outbox } = setup(item);
    await service.update(editor(), ids.item, { lockVersion: 3, meta: { slug: "new-slug" } });
    expect(repo.upsertRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPath: "/blog/my-article",
        toPath: "/blog/new-slug",
        reason: "slug_changed",
      }),
    );
    expect(repo.emit).toHaveBeenCalledWith(
      {
        itemId: ids.item,
        kind: "moved",
        paths: ["/blog/new-slug"],
        oldPaths: ["/blog/my-article"],
      },
      expect.any(String),
    );
    expect(outbox.kick).toHaveBeenCalled();
    expect(lastPatch(repo)).toMatchObject({ slug: "new-slug" });
  });

  it("a slug change on a never-published draft writes no redirect", async () => {
    const { service, repo } = setup(makeItem());
    await service.update(editor(), ids.item, { lockVersion: 3, meta: { slug: "new-slug" } });
    expect(repo.upsertRedirect).not.toHaveBeenCalled();
    expect(repo.emit).not.toHaveBeenCalled();
  });

  it("refuses a slug another item of the same type and locale uses", async () => {
    const { service, repo } = setup(makeItem());
    repo.slugTaken.mockResolvedValue(true);
    await expect(
      service.update(editor(), ids.item, { lockVersion: 3, meta: { slug: "busy" } }),
    ).rejects.toMatchObject({ code: "CONTENT_SLUG_TAKEN" });
  });

  it("refuses an unknown category and a reviewer profile that is only an author", async () => {
    const { service, repo } = setup(makeItem());
    repo.findCategory.mockResolvedValueOnce(undefined);
    await expect(
      service.update(editor(), ids.item, { lockVersion: 3, meta: { categoryId: ids.other } }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    repo.findPerson.mockResolvedValueOnce({
      id: ids.author,
      nameAr: "a",
      slug: "a",
      role: "author",
      active: true,
      userId: null,
    } as never);
    await expect(
      service.update(editor(), ids.item, { lockVersion: 3, meta: { reviewerId: ids.author } }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("autosave", () => {
  it("stores the draft for this user without creating a revision", async () => {
    const { service, repo } = setup(makeItem());
    const payload = { title: "t", excerpt: "", definition: "", bodyMd: "b" };
    const saved = await service.autosave(editor(), ids.item, { baseRevisionId: ids.rev, payload });
    expect(saved.savedAt).toBe(NOW.toISOString());
    expect(repo.upsertAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ids.item, userId: ids.writer, baseRevisionId: ids.rev }),
    );
    expect(repo.insertRevision).not.toHaveBeenCalled();
  });

  it("refuses an autosave based on an old revision", async () => {
    const { service, repo } = setup(makeItem());
    await expect(
      service.autosave(editor(), ids.item, {
        baseRevisionId: ids.rev2,
        payload: { title: "t", excerpt: "", definition: "", bodyMd: "b" },
      }),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    expect(repo.upsertAutosave).not.toHaveBeenCalled();
  });
});

describe("restore", () => {
  it("appends a restore revision copying the chosen one", async () => {
    const { service, repo } = setup(makeItem());
    repo.findRevision.mockImplementation((_item: string, revisionId: string) =>
      Promise.resolve(
        revisionId === ids.rev2
          ? makeRevision({ id: ids.rev2, number: 1, bodyMd: "old body", title: "old" })
          : makeRevision(),
      ),
    );
    await service.restore(editor(), ids.item, ids.rev2);
    expect(repo.insertRevision).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "restore", bodyMd: "old body", title: "old" }),
      NOW,
    );
  });
});

describe("corrections", () => {
  it("only live items can be corrected and the change is announced", async () => {
    const live = setup(makeItem({ status: "published", publishedRevisionId: ids.rev }));
    await live.service.addCorrection(editor(), ids.item, "fixed a dose");
    expect(live.repo.insertCorrection).toHaveBeenCalled();
    expect(live.repo.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "updated", paths: ["/blog/my-article"] }),
      expect.any(String),
    );

    const draft = setup(makeItem());
    await expect(
      draft.service.addCorrection(editor(), ids.item, "fixed a dose"),
    ).rejects.toMatchObject({
      code: "CONTENT_ILLEGAL_TRANSITION",
    });
  });
});

describe("detail", () => {
  it("offers the actions this user may take and flags unpublished changes", async () => {
    const item = makeItem({ publishedRevisionId: ids.rev2, status: "draft" });
    const { service, repo } = setup(item);
    repo.findRevision.mockResolvedValue(makeRevision({ quality: [] }));
    const detail = await service.get(ids.item, editor());
    expect(detail.allowedActions).toEqual(["submit"]);
    expect(detail.hasUnpublishedChanges).toBe(true);
    expect(detail.publicPath).toBe("/blog/my-article");
    expect(detail.live).toBe(true);
    expect(detail.apiKeyName).toBeNull();
  });
});
