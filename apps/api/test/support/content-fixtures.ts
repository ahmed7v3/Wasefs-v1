import { vi } from "vitest";

import type { ContentActorCtx } from "../../src/content/items.service.js";
import type { ContentItem, ContentRevision } from "@wasfa/db";
import type { QualityGate } from "@wasfa/shared/schemas/content";

/** Fakes for the content services: a plain object per repo method, so a test sees exactly which ones ran. */

export const ids = {
  item: "018f0000-0000-7000-8000-000000000001",
  group: "018f0000-0000-7000-8000-000000000002",
  rev: "018f0000-0000-7000-8000-000000000003",
  rev2: "018f0000-0000-7000-8000-000000000004",
  author: "018f0000-0000-7000-8000-000000000005",
  writer: "018f0000-0000-7000-8000-000000000006",
  reviewer: "018f0000-0000-7000-8000-000000000007",
  other: "018f0000-0000-7000-8000-000000000008",
};

export const NOW = new Date("2026-06-01T10:00:00.000Z");

export function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: ids.item,
    type: "article",
    locale: "ar",
    translationGroupId: ids.group,
    slug: "my-article",
    status: "draft",
    title: "عنوان",
    categoryId: null,
    primaryAuthorId: null,
    reviewerId: null,
    featuredMediaId: null,
    seo: {},
    flags: {},
    source: "editor",
    apiKeyId: null,
    externalId: null,
    currentRevisionId: ids.rev,
    reviewedRevisionId: null,
    publishedRevisionId: null,
    submittedRevisionId: null,
    submittedBy: null,
    reviewedAt: null,
    nextReviewDue: null,
    scheduledAt: null,
    publishedAt: null,
    firstPublishedAt: null,
    contentUpdatedAt: null,
    archivedAt: null,
    archivedRedirectTo: null,
    wordCount: 10,
    lockVersion: 3,
    searchText: "",
    searchTsv: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeRevision(overrides: Partial<ContentRevision> = {}): ContentRevision {
  return {
    id: ids.rev,
    itemId: ids.item,
    number: 1,
    kind: "create",
    title: "عنوان",
    excerpt: "ملخص",
    definition: "",
    bodyMd: "نص المقال",
    bodyHtml: "<p>x</p>",
    toc: [],
    wordCount: 2,
    readingMinutes: 1,
    minhash: null,
    quality: [],
    note: null,
    createdByUserId: ids.writer,
    createdByApiKeyId: null,
    createdByName: "Writer",
    diffStats: { added: 0, removed: 0 },
    parentRevisionId: null,
    createdAt: NOW,
    ...overrides,
  };
}

export function actorOf(
  userId: string,
  permissions: string[],
  isActiveReviewer = false,
): ContentActorCtx {
  return { userId, name: "Tester", permissions: new Set(permissions), isActiveReviewer };
}

export const passingGates: QualityGate[] = [
  { id: "required_fields", level: "block", ok: true, params: {} },
];
export const blockingGates: QualityGate[] = [
  { id: "min_words", level: "block", ok: false, params: { words: 3, min: 600 } },
  { id: "headings", level: "warn", ok: false, params: {} },
];

export function builtFixture(gates: QualityGate[] = passingGates) {
  return {
    render: {},
    derived: {
      bodyHtml: "<p>x</p>",
      toc: [],
      wordCount: 5,
      readingMinutes: 1,
      minhash: Buffer.alloc(512),
      quality: gates,
    },
    searchText: "x",
    links: [],
    entities: [],
    mediaRefs: [],
    gates,
  };
}

/**
 * A repo whose `transaction` hands the same fake to the callback. Every method is a `vi.fn` with a
 * harmless default; tests override the ones they care about.
 */
export function fakeRepo(item: ContentItem, revision: ContentRevision = makeRevision()) {
  const data = {
    findItem: vi.fn<(id: string) => Promise<ContentItem | undefined>>(() => Promise.resolve(item)),
    lockItem: vi.fn(() => Promise.resolve(item)),
    findRevision: vi.fn<
      (itemId: string, revisionId: string) => Promise<ContentRevision | undefined>
    >(() => Promise.resolve(revision)),
    revisionAuthor: vi.fn(() => Promise.resolve(ids.writer as string | null)),
    listRevisions: vi.fn(() => Promise.resolve([])),
    nextRevisionNumber: vi.fn(() => Promise.resolve(2)),
    findCategory: vi.fn(() =>
      Promise.resolve({
        id: ids.other,
        nameAr: "تصنيف",
        requiresMedicalReview: true,
        defaultReviewerId: null,
      } as
        | {
            id: string;
            nameAr: string;
            requiresMedicalReview: boolean;
            defaultReviewerId: string | null;
          }
        | undefined),
    ),
    findPerson: vi.fn(() => Promise.resolve(undefined)),
    isActiveReviewer: vi.fn(() => Promise.resolve(false)),
    existingTagIds: vi.fn((tagIds: string[]) => Promise.resolve(tagIds)),
    tagsOf: vi.fn(() => Promise.resolve([])),
    siblingTranslation: vi.fn(() => Promise.resolve(undefined)),
    localeInGroup: vi.fn(() => Promise.resolve(false)),
    findAutosave: vi.fn(() => Promise.resolve(undefined)),
    listComments: vi.fn(() => Promise.resolve([])),
    slugsLike: vi.fn(() => Promise.resolve([] as string[])),
    slugTaken: vi.fn(() => Promise.resolve(false)),
    readyMedia: vi.fn(() => Promise.resolve([])),
    insertItem: vi.fn(() => Promise.resolve(item)),
    insertRevision: vi.fn(() => Promise.resolve(makeRevision({ id: ids.rev2, number: 2 }))),
    updateItem: vi.fn<(id: string, patch: Partial<ContentItem>) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    updateRevisionQuality: vi.fn(() => Promise.resolve()),
    setItemTags: vi.fn(() => Promise.resolve()),
    replaceLinks: vi.fn(() => Promise.resolve()),
    replaceEntities: vi.fn(() => Promise.resolve()),
    replaceMediaRefs: vi.fn(() => Promise.resolve()),
    upsertAutosave: vi.fn(() => Promise.resolve()),
    deleteAutosave: vi.fn(() => Promise.resolve()),
    insertPublishLog: vi.fn(() => Promise.resolve()),
    insertReviewComment: vi.fn(() => Promise.resolve()),
    insertCorrection: vi.fn(() => Promise.resolve()),
    upsertRedirect: vi.fn(() => Promise.resolve()),
    deleteArchivedRedirect: vi.fn(() => Promise.resolve(false)),
    lockPublishCap: vi.fn(() => Promise.resolve()),
    countPublishedSince: vi.fn(() => Promise.resolve(0)),
    publish: vi.fn(() => Promise.resolve({})),
    unpublish: vi.fn(() => Promise.resolve()),
    emit: vi.fn(() => Promise.resolve()),
    transaction: vi.fn(),
  };
  data.transaction.mockImplementation((fn: (tx: typeof data) => Promise<unknown>) => fn(data));
  return data;
}

export function fakeSettings(overrides: Record<string, unknown> = {}) {
  const value = {
    maxPublishesPerDay: 25,
    timeZone: "Africa/Cairo",
    previewTokenHours: 24,
    defaultAuthorId: null,
    reviewIntervalDays: { general: 365, highRisk: 180 },
    titleSimilarityBlockAt: 0.9,
    ...overrides,
  };
  return { get: vi.fn(() => Promise.resolve(value)) };
}
