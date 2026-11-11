import { ErrorCode, AppError } from "@wasfa/shared/errors";
import { publishingArticleInputSchema } from "@wasfa/shared/schemas/publishing";
import { describe, expect, it, vi } from "vitest";

import {
  PublishingApiArticlesService,
  assertScheduleWindow,
  parseIfMatch,
  translateContentError,
} from "../src/publishing/publishing-api-articles.service.js";

import { blockingGates, ids, makeItem, makeRevision } from "./support/content-fixtures.js";

import type { ContentActorCtx } from "../src/content/items.service.js";
import type { PublishingPrincipal } from "../src/publishing/publishing-principal.js";
import type { ContentItem } from "@wasfa/db";
import type { ContentItemDetail, QualityGate } from "@wasfa/shared/schemas/content";
import type { FastifyRequest } from "fastify";

/*
 * The Publishing API's article service against fakes of the content stack: which workflow action each
 * request leads to, what is refused and what is saved anyway, ownership, If-Match, cursors and the audit
 * trail. The decision table itself is in publishing-api-decision.units.test.ts.
 */

const KEY = "018f0000-0000-7000-8000-0000000000aa";
const OTHER_KEY = "018f0000-0000-7000-8000-0000000000dd";
const OWNER = "018f0000-0000-7000-8000-0000000000bb";
const CAT = "018f0000-0000-7000-8000-0000000000c1";
const AUTHOR = "018f0000-0000-7000-8000-0000000000c2";
const MEDIA = "018f0000-0000-7000-8000-0000000000c3";

const principal = (over: Partial<PublishingPrincipal> = {}): PublishingPrincipal => ({
  keyId: KEY,
  keyName: "Agent",
  ownerUserId: OWNER,
  scopes: ["content:read", "content:write", "content:publish"],
  canPublish: true,
  allowedTypes: [],
  allowedCategorySlugs: [],
  defaultAuthorId: AUTHOR,
  defaultFeaturedMediaId: MEDIA,
  dailyPublishCap: 5,
  requestsPerMinute: 60,
  ...over,
});

const passing: QualityGate[] = [{ id: "required_fields", level: "block", ok: true, params: {} }];
const medicalGate: QualityGate = { id: "medical_review", level: "block", ok: false, params: {} };

const article = (extra: Record<string, unknown> = {}) =>
  publishingArticleInputSchema.parse({
    type: "article",
    locale: "ar",
    title: "كيف تتناول المضاد الحيوي بطريقة صحيحة",
    slug: "taking-antibiotics-correctly",
    excerpt: "خطوات بسيطة تساعدك على الالتزام بمواعيد المضاد الحيوي ومدته كما وصفها الطبيب.",
    body_markdown: "## لماذا\n\nنص.\n",
    category: "medicines-basics",
    sources: [{ title: "WHO", url: "https://www.who.int/x" }],
    ...extra,
  });

function detailOf(over: Partial<ContentItemDetail> = {}): ContentItemDetail {
  return {
    id: ids.item,
    type: "article",
    locale: "ar",
    slug: "taking-antibiotics-correctly",
    status: "draft",
    live: false,
    title: "عنوان",
    wordCount: 700,
    publishedAt: null,
    updatedAt: "2026-11-09T10:00:00.000Z",
    scheduledAt: null,
    reviewer: null,
    requiresReview: false,
    currentRevision: { id: ids.rev, number: 1 },
    lockVersion: 0,
    gates: passing,
    publicPath: null,
    meta: { flags: {} },
    ...over,
  } as unknown as ContentItemDetail;
}

interface Options {
  medical?: boolean;
  gates?: QualityGate[];
  row?: Partial<ContentItem>;
  tags?: {
    id: string;
    slugAr: string | null;
    slugEn: string | null;
    nameAr: string;
    nameEn: string | null;
  }[];
}

function harness(options: Options = {}) {
  const medical = options.medical ?? false;
  const gates = options.gates ?? (medical ? [...passing, medicalGate] : passing);
  const state = {
    detail: detailOf({ requiresReview: medical, gates }),
    row: makeItem({ apiKeyId: KEY, source: "api", externalId: "kb-1", ...options.row }),
  };
  const items = {
    create: vi.fn<(a: ContentActorCtx, i: unknown, o?: unknown) => Promise<ContentItemDetail>>(() =>
      Promise.resolve(state.detail),
    ),
    update: vi.fn(
      (...args: [ContentActorCtx, string, { meta?: { flags?: Record<string, unknown> } }]) => {
        const input = args[2];
        if (input.meta?.flags) {
          state.detail = {
            ...state.detail,
            meta: {
              ...state.detail.meta,
              flags: { ...state.detail.meta.flags, ...input.meta.flags },
            },
          };
        }
        return Promise.resolve(state.detail);
      },
    ),
    get: vi.fn(() => Promise.resolve(state.detail)),
    listRevisions: vi.fn(() =>
      Promise.resolve([
        {
          number: 1,
          kind: "api",
          createdAt: "2026-11-09T10:00:00.000Z",
          createdBy: { type: "api_key", id: null, name: "Agent" },
          isApproved: false,
          isPublished: false,
        },
      ]),
    ),
  };
  const workflow = {
    act: vi.fn((...args: [string, string, unknown?, ContentActorCtx?]) => {
      const action = args[1];
      const to =
        (
          { submit: "in_review", publish: "published", schedule: "scheduled" } as Record<
            string,
            string
          >
        )[action] ?? "draft";
      const from = state.detail.status;
      state.detail = {
        ...state.detail,
        status: to as ContentItemDetail["status"],
        live: action === "publish" ? true : state.detail.live,
      };
      return Promise.resolve({ from, to, overridden: [] as string[] });
    }),
  };
  const repo = {
    findItem: vi.fn((id: string) => Promise.resolve(id === state.row.id ? state.row : undefined)),
    findRevision: vi.fn(() => Promise.resolve(makeRevision({ number: 3, bodyMd: "body" }))),
    slugTaken: vi.fn(() => Promise.resolve(false)),
    transaction: vi.fn(),
  };
  const renderer = { build: vi.fn() };
  const previews = {
    create: vi.fn(() => Promise.reject(new AppError(ErrorCode.NOT_FOUND))),
  };
  const taxonomy = {
    listCategories: vi.fn(() =>
      Promise.resolve({
        items: [
          {
            id: CAT,
            slugAr: "medicines-basics",
            slugEn: null,
            nameAr: "أساسيات",
            requiresMedicalReview: medical,
          },
        ],
      }),
    ),
    listTags: vi.fn(() => Promise.resolve({ items: options.tags ?? [] })),
    createTag: vi.fn((...args: [string, unknown, { nameAr: string }]) => {
      const input = args[2];
      return Promise.resolve({ id: "018f0000-0000-7000-8000-0000000000e1", ...input });
    }),
  };
  const people = {
    list: vi.fn(() =>
      Promise.resolve({
        items: [{ id: AUTHOR, slug: "dr-sara", active: true, role: "both" }],
      }),
    ),
  };
  const api = {
    findByExternalId: vi.fn((...args: [string, string]) => {
      const external = args[1];
      return Promise.resolve(external === "kb-1" ? state.row : undefined);
    }),
    findBySlug: vi.fn(() => Promise.resolve(undefined as ContentItem | undefined)),
    list: vi.fn((...args: [string, unknown, string | undefined, unknown?]) => {
      void args;
      return Promise.resolve([] as unknown[]);
    }),
  };
  const audit = { recordFor: vi.fn(() => Promise.resolve()) };
  const service = new PublishingApiArticlesService(
    items as never,
    repo as never,
    workflow as never,
    renderer as never,
    previews as never,
    taxonomy as never,
    people as never,
    api as never,
    audit as never,
    { WEB_ORIGIN: ["https://wasfa.online"] } as never,
  );
  return { service, state, items, workflow, repo, taxonomy, api, audit };
}

const request = {} as FastifyRequest;
const acts = (h: ReturnType<typeof harness>) => h.workflow.act.mock.calls.map((call) => call[1]);

describe("create: desired_status through the workflow", () => {
  it("draft (the default): nothing is run, 201, the key's defaults are reported", async () => {
    const h = harness();
    const result = await h.service.create(principal(), request, article());
    expect(result.status).toBe(201);
    expect(result.article).toMatchObject({
      status: "draft",
      created: true,
      live: false,
      url: null,
    });
    expect(h.workflow.act).not.toHaveBeenCalled();
    expect(result.article.notes.join(" ")).toMatch(/default author/);
    // The actor handed to the content stack is the key, as a machine actor that is not the owner.
    const actor = h.items.create.mock.calls[0]?.[0];
    expect(actor?.isOwner).toBe(false);
    expect(actor?.machine).toMatchObject({ type: "api_key", keyId: KEY, dailyPublishCap: 5 });
  });

  it("(d) non-medical, may publish, gates pass -> published, with its URL", async () => {
    const h = harness();
    h.state.row = makeItem({ apiKeyId: KEY, externalId: "kb-1", publishedRevisionId: ids.rev });
    const result = await h.service.create(
      principal(),
      request,
      article({ desired_status: "published" }),
    );
    expect(acts(h)).toEqual(["publish"]);
    expect(result.article).toMatchObject({
      status: "published",
      live: true,
      url: "https://wasfa.online/blog/my-article",
    });
  });

  it("(d) gates fail -> the item is SAVED as a draft and the answer is 422 with details.blocking", async () => {
    const h = harness({ gates: blockingGates });
    await expect(
      h.service.create(principal(), request, article({ desired_status: "published" })),
    ).rejects.toMatchObject({
      code: ErrorCode.CONTENT_GATES_BLOCK,
      httpStatus: 422,
      details: expect.objectContaining({
        blocking: ["min_words"],
        item_id: ids.item,
        saved: true,
      }) as unknown,
    });
    expect(h.items.create).toHaveBeenCalledTimes(1);
    expect(h.workflow.act).not.toHaveBeenCalled();
  });

  it("(c) medical + may publish + published -> in_review with publish_on_approval stored; never published", async () => {
    const h = harness({ medical: true });
    const result = await h.service.create(
      principal(),
      request,
      article({ desired_status: "published" }),
    );
    expect(acts(h)).toEqual(["submit"]);
    expect(h.items.update).toHaveBeenCalledWith(
      expect.anything(),
      ids.item,
      expect.objectContaining({
        meta: { flags: { publishOnApproval: true, publishOnApprovalCap: 5 } },
      }),
    );
    expect(result.article).toMatchObject({
      status: "in_review",
      publish_on_approval: true,
      live: false,
      url: null,
    });
    expect(result.article.notes.join(" ")).toMatch(/reviewer/);
  });

  it("(b) a key that cannot publish: medical -> in_review without auto-publish, and it says why", async () => {
    const h = harness({ medical: true });
    const result = await h.service.create(
      principal({ canPublish: false }),
      request,
      article({ desired_status: "published", publish_on_approval: true }),
    );
    expect(acts(h)).toEqual(["submit"]);
    expect(h.items.update).not.toHaveBeenCalled();
    expect(result.article).toMatchObject({ status: "in_review", publish_on_approval: false });
    expect(result.article.notes.join(" ")).toMatch(/cannot publish/);
  });

  it("(b) a key that cannot publish: non-medical -> stays a draft and says why", async () => {
    const h = harness();
    const result = await h.service.create(
      principal({ canPublish: false }),
      request,
      article({ desired_status: "published" }),
    );
    expect(h.workflow.act).not.toHaveBeenCalled();
    expect(result.article.status).toBe("draft");
    expect(result.article.notes.join(" ")).toMatch(/cannot publish/);
  });

  it("(b) a key without the content:publish scope is treated the same way", async () => {
    const h = harness();
    await h.service.create(
      principal({ scopes: ["content:read", "content:write"] }),
      request,
      article({ desired_status: "published" }),
    );
    expect(h.workflow.act).not.toHaveBeenCalled();
  });

  it("(h) a near-duplicate is a 409 naming the matching item (and its external id when it is this key's)", async () => {
    const gates: QualityGate[] = [
      {
        id: "duplicate_content",
        level: "block",
        ok: false,
        params: { score: 0.8, matchPath: "/blog/original-piece" },
      },
    ];
    const h = harness({ gates });
    h.api.findBySlug.mockResolvedValue(
      makeItem({
        id: "018f0000-0000-7000-8000-0000000000f1",
        slug: "original-piece",
        apiKeyId: KEY,
        externalId: "kb-77",
      }),
    );
    await expect(
      h.service.create(principal(), request, article({ desired_status: "published" })),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      httpStatus: 409,
      details: expect.objectContaining({
        code: "DUPLICATE_CONTENT",
        matching_item_id: "018f0000-0000-7000-8000-0000000000f1",
        matching_url: "https://wasfa.online/blog/original-piece",
        matching_external_id: "kb-77",
        saved: true,
      }) as unknown,
    });
    expect(h.api.findBySlug).toHaveBeenCalledWith("article", "ar", "original-piece");
  });

  it("other blocking gates stop a medical submission: saved as a draft, reviewers are not bothered", async () => {
    const h = harness({ medical: true, gates: [...blockingGates, medicalGate] });
    await expect(
      h.service.create(principal(), request, article({ desired_status: "in_review" })),
    ).rejects.toMatchObject({ code: ErrorCode.CONTENT_GATES_BLOCK });
    expect(h.workflow.act).not.toHaveBeenCalled();
  });

  it("POST with an external_id that exists is refused: use PUT", async () => {
    const h = harness();
    await expect(
      h.service.create(principal(), request, article({ external_id: "kb-1" })),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      details: expect.objectContaining({ reason: "external_id_exists" }) as unknown,
    });
    expect(h.items.create).not.toHaveBeenCalled();
  });
});

describe("(i) every write is attributed to the key", () => {
  it("records an audit entry whose actor is api_key:<id>, owner recorded alongside", async () => {
    const h = harness();
    await h.service.create(principal(), request, article({ desired_status: "published" }));
    expect(h.audit.recordFor).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        actorId: null,
        action: "content.item.created",
        targetType: "content_item",
        targetId: ids.item,
        after: expect.objectContaining({
          actor: `api_key:${KEY}`,
          key_name: "Agent",
          owner_user_id: OWNER,
          source: "api",
        }) as unknown,
      }),
      { verbatim: true },
    );
  });

  it("an external_id is passed to the content stack so the key owns it", async () => {
    const h = harness();
    await h.service.create(principal(), request, article({ external_id: "kb-9" }));
    expect(h.items.create.mock.calls[0]?.[2]).toEqual({ externalId: "kb-9" });
  });
});

describe("restrictions are enforced before anything is written", () => {
  it("allowedCategorySlugs -> FORBIDDEN, nothing created", async () => {
    const h = harness();
    await expect(
      h.service.create(principal({ allowedCategorySlugs: ["nutrition"] }), request, article()),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(h.items.create).not.toHaveBeenCalled();
  });

  it("allowedTypes -> FORBIDDEN", async () => {
    const h = harness();
    await expect(
      h.service.create(principal({ allowedTypes: ["glossary"] }), request, article()),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("an unknown category, author or tag is a validation error listing the field", async () => {
    const h = harness();
    await expect(
      h.service.create(principal(), request, article({ category: "no-such-category" })),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: expect.objectContaining({ fields: ["category"] }) as unknown,
    });
    await expect(
      h.service.create(principal(), request, article({ author: "nobody" })),
    ).rejects.toMatchObject({
      details: expect.objectContaining({ fields: ["author"] }) as unknown,
    });
  });
});

describe("tags", () => {
  it("unknown tags need taxonomy:write, otherwise VALIDATION_FAILED lists them", async () => {
    const h = harness();
    await expect(
      h.service.create(principal(), request, article({ tags: ["new tag", "another"] })),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      details: expect.objectContaining({
        fields: ["tags"],
        messages: [expect.stringContaining("new tag, another")],
      }) as unknown,
    });
    expect(h.taxonomy.createTag).not.toHaveBeenCalled();
    expect(h.items.create).not.toHaveBeenCalled();
  });

  it("with taxonomy:write they are created, and known ones are matched by name or slug", async () => {
    const h = harness({
      tags: [
        {
          id: "018f0000-0000-7000-8000-0000000000e9",
          slugAr: null,
          slugEn: "antibiotics",
          nameAr: "مضادات",
          nameEn: "Antibiotics",
        },
      ],
    });
    await h.service.create(
      principal({ scopes: ["content:read", "content:write", "taxonomy:write"] }),
      request,
      article({ tags: ["ANTIBIOTICS", "brand new"] }),
    );
    expect(h.taxonomy.createTag).toHaveBeenCalledTimes(1);
    const create = h.items.create.mock.calls[0]?.[1] as { meta: { tagIds: string[] } };
    expect(create.meta.tagIds).toHaveLength(2);
  });
});

describe("PUT by external id", () => {
  it("an unknown id creates (201), registered under the key", async () => {
    const h = harness();
    const result = await h.service.upsert(principal(), request, "kb-new", article(), null);
    expect(result.status).toBe(201);
    expect(h.items.create.mock.calls[0]?.[2]).toEqual({ externalId: "kb-new" });
  });

  it("the same id updates the same item (200), never a second one", async () => {
    const h = harness();
    const result = await h.service.upsert(principal(), request, "kb-1", article(), null);
    expect(result.status).toBe(200);
    expect(result.article).toMatchObject({ id: ids.item, created: false });
    expect(h.items.create).not.toHaveBeenCalled();
    const update = h.items.update.mock.calls[0];
    expect(update?.[1]).toBe(ids.item);
    expect(update?.[2]).toMatchObject({ lockVersion: h.state.row.lockVersion, note: "api" });
  });

  it("type and locale cannot change on an existing item", async () => {
    const h = harness();
    await expect(
      h.service.upsert(principal(), request, "kb-1", article({ type: "guide" }), null),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it("an external_id in the body must match the one in the URL", async () => {
    const h = harness();
    await expect(
      h.service.upsert(principal(), request, "kb-1", article({ external_id: "other" }), null),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it("a published item's slug is locked: moving a public URL is a human decision", async () => {
    const h = harness({ row: { firstPublishedAt: new Date() } });
    await expect(
      h.service.upsert(principal(), request, "kb-1", article({ slug: "a-different-slug" }), null),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe("(g) If-Match and ETag", () => {
  it("parses the common spellings of a revision", () => {
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch("3")).toBe(3);
    expect(parseIfMatch('W/"12"')).toBe(12);
    expect(parseIfMatch(undefined)).toBeNull();
    expect(parseIfMatch("*")).toBeNull();
    expect(parseIfMatch("abc")).toBeNull();
  });

  it("a stale If-Match is CONTENT_CONFLICT with HTTP 412 and the current revision; nothing is written", async () => {
    const h = harness();
    await expect(
      h.service.upsert(principal(), request, "kb-1", article(), 2),
    ).rejects.toMatchObject({
      code: ErrorCode.CONTENT_CONFLICT,
      httpStatus: 412,
      details: { current_revision: 3 },
    });
    expect(h.items.update).not.toHaveBeenCalled();
  });

  it("a matching If-Match goes through, and the answer carries the revision (the ETag)", async () => {
    const h = harness();
    const result = await h.service.upsert(principal(), request, "kb-1", article(), 3);
    expect(result.article.revision).toBe(1);
    expect(h.items.update).toHaveBeenCalled();
  });

  it("without If-Match a concurrent save is retried on top (history keeps both)", async () => {
    const h = harness();
    h.items.update.mockRejectedValueOnce(new AppError(ErrorCode.CONTENT_CONFLICT));
    const result = await h.service.upsert(principal(), request, "kb-1", article(), null);
    expect(result.status).toBe(200);
    expect(
      h.items.update.mock.calls.filter((call) => "payload" in (call[2] as object)),
    ).toHaveLength(2);
  });
});

describe("ownership and visibility", () => {
  it("a key cannot write to an item another key (or an editor) created: 404", async () => {
    const h = harness({ row: { apiKeyId: OTHER_KEY } });
    await expect(
      h.service.patch(principal(), request, ids.item, { ai_assisted: true }, null),
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(h.service.publish(principal(), request, ids.item, {}, null)).rejects.toMatchObject(
      {
        code: ErrorCode.NOT_FOUND,
      },
    );
    await expect(h.service.remove(principal(), request, ids.item, undefined)).rejects.toMatchObject(
      {
        code: ErrorCode.NOT_FOUND,
      },
    );
    expect(h.items.update).not.toHaveBeenCalled();
    expect(h.workflow.act).not.toHaveBeenCalled();
  });

  it("reads: own items always, other keys' items only when published", async () => {
    const hidden = harness({ row: { apiKeyId: OTHER_KEY } });
    await expect(hidden.service.get(principal(), ids.item)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    const live = harness({ row: { apiKeyId: OTHER_KEY, publishedRevisionId: ids.rev } });
    await expect(live.service.get(principal(), ids.item)).resolves.toMatchObject({ id: ids.item });
    await expect(harness().service.get(principal(), "not-a-uuid")).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("pages are never reachable through the API", async () => {
    const h = harness({ row: { type: "page", apiKeyId: KEY } });
    await expect(h.service.get(principal(), ids.item)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe("workflow endpoints", () => {
  it("publish on a medical draft asks for review and auto-publish (the human asked to publish)", async () => {
    const h = harness({ medical: true });
    const article = await h.service.publish(principal(), request, ids.item, {}, null);
    expect(acts(h)).toEqual(["submit"]);
    expect(article).toMatchObject({ status: "in_review", publish_on_approval: true });
  });

  it("publish with publish_on_approval=false does not arrange an automatic publish", async () => {
    const h = harness({ medical: true });
    const article = await h.service.publish(
      principal(),
      request,
      ids.item,
      { publish_on_approval: false },
      null,
    );
    expect(article.publish_on_approval).toBe(false);
    expect(article.notes.join(" ")).toMatch(/will NOT publish by itself/);
  });

  it("schedule needs 5 minutes to 365 days of lead time", async () => {
    const h = harness();
    const soon = new Date(Date.now() + 60_000).toISOString();
    await expect(
      h.service.schedule(principal(), request, ids.item, soon, null),
    ).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    const ok = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await h.service.schedule(principal(), request, ids.item, ok, null);
    expect(acts(h)).toEqual(["schedule"]);
    expect(scheduled.status).toBe("scheduled");
    expect(h.workflow.act.mock.calls[0]?.[2]).toEqual({ at: ok });
  });

  it("assertScheduleWindow boundaries", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    expect(() => assertScheduleWindow(new Date(now.getTime() + 5 * 60_000), now)).not.toThrow();
    expect(() => assertScheduleWindow(new Date(now.getTime() + 4 * 60_000), now)).toThrow();
    expect(() => assertScheduleWindow(new Date(now.getTime() + 366 * 86_400_000), now)).toThrow();
  });

  it("unpublish needs a key that may publish", async () => {
    const h = harness({ row: { publishedRevisionId: ids.rev, status: "published" } });
    await expect(
      h.service.unpublish(principal({ canPublish: false }), request, ids.item),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    await h.service.unpublish(principal(), request, ids.item);
    expect(acts(h)).toEqual(["unpublish"]);
  });

  it("delete archives a published item only for a key that may publish, and passes redirect_to", async () => {
    const h = harness({
      row: { publishedRevisionId: ids.rev, firstPublishedAt: new Date(), status: "published" },
    });
    await expect(
      h.service.remove(principal({ canPublish: false }), request, ids.item, undefined),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    const result = await h.service.remove(principal(), request, ids.item, "/blog/other");
    expect(result).toEqual({ id: ids.item, result: "archived" });
    expect(h.workflow.act).toHaveBeenCalledWith(
      ids.item,
      "archive",
      { redirectTo: "/blog/other" },
      expect.anything(),
    );
    // The archive permission is granted for the key's own item, nothing wider.
    const actor = h.workflow.act.mock.calls[0]?.[3] as unknown as ContentActorCtx;
    expect(actor.permissions.has("content.manage")).toBe(true);
    expect(actor.isOwner).toBe(false);
  });
});

describe("list: cursor pagination", () => {
  const row = (n: number) => ({
    item: makeItem({
      id: `018f0000-0000-7000-8000-00000000010${String(n)}`,
      apiKeyId: KEY,
      externalId: `kb-${String(n)}`,
      updatedAt: new Date(`2026-11-09T10:0${String(n)}:00Z`),
    }),
    revisionNumber: n,
    quality: passing,
    cursorAt: `2026-11-09T10:0${String(n)}:00.000000Z`,
  });

  it("asks for limit+1 rows and returns an opaque next_cursor that decodes back to the last row shown", async () => {
    const h = harness();
    h.api.list.mockResolvedValue([row(3), row(2), row(1)]);
    const page = await h.service.list(principal(), { limit: 2 });
    expect(page.items.map((item) => item.external_id)).toEqual(["kb-3", "kb-2"]);
    expect(page.next_cursor).toBe(
      Buffer.from(`2026-11-09T10:02:00.000000Z|018f0000-0000-7000-8000-000000000102`).toString(
        "base64url",
      ),
    );
    expect(h.api.list).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({ limit: 2 }),
      undefined,
      undefined,
    );
  });

  it("the last page has no cursor, and a returned cursor is passed back decoded", async () => {
    const h = harness();
    h.api.list.mockResolvedValue([row(1)]);
    const cursor = Buffer.from(
      "2026-11-09T10:02:00.000000Z|018f0000-0000-7000-8000-000000000102",
    ).toString("base64url");
    const page = await h.service.list(principal(), { limit: 2, cursor });
    expect(page.next_cursor).toBeNull();
    expect(h.api.list.mock.calls[0]?.[3]).toEqual({
      at: "2026-11-09T10:02:00.000000Z",
      key: "018f0000-0000-7000-8000-000000000102",
    });
  });

  it("a malformed cursor is a validation error", async () => {
    const h = harness();
    await expect(h.service.list(principal(), { limit: 2, cursor: "bm9wZQ" })).rejects.toMatchObject(
      {
        code: ErrorCode.VALIDATION_FAILED,
      },
    );
  });

  it("filters by category slug (unknown slug is refused)", async () => {
    const h = harness();
    await h.service.list(principal(), { limit: 5, category: "medicines-basics" });
    expect(h.api.list.mock.calls[0]?.[2]).toBe(CAT);
    await expect(h.service.list(principal(), { limit: 5, category: "nope" })).rejects.toMatchObject(
      {
        code: ErrorCode.VALIDATION_FAILED,
      },
    );
  });
});

describe("translateContentError", () => {
  it("renames the editor's field paths to the API's", () => {
    const error = new AppError(ErrorCode.VALIDATION_FAILED, {
      details: { fields: ["meta.featuredMediaId", "meta.tagIds"] },
    });
    const translated = translateContentError(error) as AppError;
    expect(translated.details?.fields).toEqual(["featured_media_id", "tags"]);
    expect(String(translated.details?.messages)).toContain("READY");
  });

  it("leaves other errors alone", () => {
    const other = new AppError(ErrorCode.NOT_FOUND);
    expect(translateContentError(other)).toBe(other);
    expect(translateContentError(new Error("x"))).toBeInstanceOf(Error);
  });
});
