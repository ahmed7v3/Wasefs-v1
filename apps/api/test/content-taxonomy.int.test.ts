import { randomUUID } from "node:crypto";

import {
  auditLogs,
  contentCategories,
  contentItems,
  contentItemTags,
  contentMediaRefs,
  contentPeople,
  contentRevisions,
  contentTags,
  mediaAssets,
  outbox,
  slugRedirects,
} from "@wasfa/db";
import {
  bulkResultSchema,
  contentOptionsSchema,
  redirectTestResponseSchema,
  reviewInboxResponseSchema,
} from "@wasfa/shared/schemas/content";
import { mediaUsageResponseSchema } from "@wasfa/shared/schemas/media";
import { eq, like, notExists, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";

/*
 * Content taxonomy admin API against Postgres and Redis: categories, tags (merge), people, redirects,
 * options, bulk actions (schedule_series needs the workflow port, see TaxonomyModule), the review
 * inbox, permissions, audit rows and the media usage endpoint. Written for CI (Docker); not run where
 * Docker is unavailable.
 */

const ctx = new AdminTestContext();
let admin: Admin;

beforeAll(async () => {
  await ctx.start();
  admin = await ctx.admin("admin");
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  const db = ctx.owner.db;
  await db.delete(contentMediaRefs);
  await db.delete(contentItemTags);
  // Items with a revision are kept for good (append-only history, FK-restricted).
  await db.delete(contentItems).where(
    notExists(
      db
        .select({ one: sql`1` })
        .from(contentRevisions)
        .where(eq(contentRevisions.itemId, contentItems.id)),
    ),
  );
  await db.delete(slugRedirects);
  await db.delete(contentTags);
  await db.delete(contentCategories);
  await db.delete(contentPeople);
  await db.delete(outbox).where(like(outbox.topic, "content.%"));
  await db.delete(auditLogs).where(like(auditLogs.action, "content.%"));
});

const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  who: { jar: Admin["jar"] } = admin,
) =>
  ctx.harness.call(method, `/admin/content/${path}`, {
    jar: who.jar,
    ...(body === undefined ? {} : { body }),
  });

const auditActions = async (): Promise<string[]> =>
  (await ctx.owner.db.select().from(auditLogs).where(like(auditLogs.action, "content.%")))
    .map((row) => row.action)
    .sort();

const category = (slug: string, overrides: Record<string, unknown> = {}) => ({
  slugAr: slug,
  nameAr: `تصنيف ${slug}`,
  ...overrides,
});

async function makeCategory(slug: string, overrides: Record<string, unknown> = {}) {
  const res = await call("POST", "categories", category(slug, overrides));
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string };
}

/** `live: true` also writes a revision and points `published_revision_id` at it (the FK is real). */
async function makeItem(
  overrides: Partial<typeof contentItems.$inferInsert> = {},
  options: { live?: boolean } = {},
) {
  const revisionId = options.live === true ? randomUUID() : undefined;
  return ctx.owner.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contentItems)
      .values({
        type: "article",
        locale: "ar",
        translationGroupId: randomUUID(),
        slug: `item-${randomUUID().slice(0, 8)}`,
        title: "عنوان",
        ...(revisionId === undefined
          ? {}
          : { currentRevisionId: revisionId, publishedRevisionId: revisionId }),
        ...overrides,
      })
      .returning();
    if (row === undefined) throw new Error("no row");
    if (revisionId !== undefined) {
      await tx.insert(contentRevisions).values({
        id: revisionId,
        itemId: row.id,
        number: 1,
        kind: "create",
        title: row.title,
        excerpt: "",
        bodyMd: "",
        bodyHtml: "",
        createdByName: "tester",
      });
    }
    return row;
  });
}

async function makePerson(slug: string, role: "author" | "reviewer" | "both", userId?: string) {
  const res = await call("POST", "people", {
    slug,
    nameAr: `شخص ${slug}`,
    role,
    licenceNumber: "EG-SECRET-1",
    ...(userId === undefined ? {} : { userId }),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string };
}

describe("permissions", () => {
  it("asks for sign-in and the content permissions", async () => {
    expect((await ctx.harness.call("GET", "/admin/content/categories")).statusCode).toBe(401);

    const noManage = await ctx.admin(await ctx.roleLacking("content.manage"));
    expect((await call("GET", "categories", undefined, noManage)).statusCode).toBe(200);
    expect((await call("POST", "categories", category("x"), noManage)).statusCode).toBe(403);
    expect(
      (await call("POST", "bulk", { action: "unpublish", ids: [MISSING_ID] }, noManage)).statusCode,
    ).toBe(403);

    const noRead = await ctx.admin(await ctx.roleLacking("content.read"));
    expect((await call("GET", "tags", undefined, noRead)).statusCode).toBe(403);

    const noWrite = await ctx.admin(await ctx.roleLacking("content.write"));
    // The editor's pickers are a read: content.read is enough.
    expect((await call("GET", "options", undefined, noWrite)).statusCode).toBe(200);
    expect((await call("GET", "options", undefined, noRead)).statusCode).toBe(403);
    expect(
      (await call("GET", `link-suggestions?itemId=${MISSING_ID}&q=a&locale=ar`, undefined, noWrite))
        .statusCode,
    ).toBe(403);

    const noReview = await ctx.admin(await ctx.roleLacking("content.review"));
    expect((await call("GET", "review-inbox", undefined, noReview)).statusCode).toBe(403);
  });

  it("asks for a fresh sign-in on bulk actions", async () => {
    const stale = await ctx.admin("admin");
    await ctx.makeSessionStale(stale.userId);
    const res = await call("POST", "bulk", { action: "unpublish", ids: [MISSING_ID] }, stale);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ details: { reason: "reauth" } });
  });
});

describe("categories", () => {
  it("creates, lists in tree order with item counts, updates and audits", async () => {
    const parent = await makeCategory("parent", { sort: 1 });
    const child = await call("POST", "categories", category("child", { parentId: parent.id }));
    expect(child.statusCode).toBe(201);
    await makeCategory("first", { sort: 0 });
    await makeItem({ categoryId: parent.id });

    const list = (await call("GET", "categories")).json() as {
      items: { slugAr: string; itemCount: number }[];
    };
    expect(list.items.map((row) => row.slugAr)).toEqual(["first", "parent", "child"]);
    expect(list.items.find((row) => row.slugAr === "parent")?.itemCount).toBe(1);

    const patch = await call(
      "PATCH",
      `categories/${parent.id}`,
      category("parent", { requiresMedicalReview: false }),
    );
    expect(patch.statusCode, patch.body).toBe(200);
    const audits = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "content.category.update"));
    expect(audits[0]?.before).toMatchObject({ requiresMedicalReview: true });
    expect(audits[0]?.after).toMatchObject({ requiresMedicalReview: false });
    expect(await auditActions()).toContain("content.category.create");
  });

  it("enforces depth two and unique slugs", async () => {
    const root = await makeCategory("root");
    const child = (await (
      await call("POST", "categories", category("kid", { parentId: root.id }))
    ).json()) as { id: string };
    const tooDeep = await call("POST", "categories", category("grand", { parentId: child.id }));
    expect(tooDeep.statusCode).toBe(400);
    // A parent with children cannot become a child.
    const other = await makeCategory("other");
    const demote = await call(
      "PATCH",
      `categories/${root.id}`,
      category("root", { parentId: other.id }),
    );
    expect(demote.statusCode).toBe(400);

    const dupAr = await call("POST", "categories", category("root"));
    expect(dupAr.statusCode).toBe(409);
    expect(dupAr.json()).toMatchObject({ code: "CONTENT_SLUG_TAKEN" });
    await makeCategory("en-one", { slugEn: "english" });
    const dupEn = await call("POST", "categories", category("en-two", { slugEn: "english" }));
    expect(dupEn.json()).toMatchObject({
      code: "CONTENT_SLUG_TAKEN",
      details: { fields: ["slugEn"] },
    });
  });

  it("refuses to delete a category with items or children, deletes an empty one", async () => {
    const used = await makeCategory("used");
    await makeItem({ categoryId: used.id });
    const blocked = await call("DELETE", `categories/${used.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "CONTENT_IN_USE", details: { itemCount: 1 } });

    const parent = await makeCategory("p");
    await call("POST", "categories", category("c", { parentId: parent.id }));
    expect((await call("DELETE", `categories/${parent.id}`)).json()).toMatchObject({
      code: "CONTENT_IN_USE",
    });

    const empty = await makeCategory("empty");
    expect((await call("DELETE", `categories/${empty.id}`)).statusCode).toBe(204);
    expect((await call("DELETE", `categories/${empty.id}`)).statusCode).toBe(404);
  });

  it("reorders siblings and refuses an incomplete list", async () => {
    const a = await makeCategory("a");
    const b = await makeCategory("b");
    const ok = await call("POST", "categories/reorder", { parentId: null, ids: [b.id, a.id] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as { items: { id: string }[] }).items.map((row) => row.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(
      (await call("POST", "categories/reorder", { parentId: null, ids: [a.id] })).statusCode,
    ).toBe(400);
  });

  it("emits a content.changed taxonomy event", async () => {
    await makeCategory("evt");
    const rows = await ctx.owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.topic, "content.changed"));
    expect(rows.some((row) => (row.payload as { kind?: string }).kind === "taxonomy")).toBe(true);
  });
});

describe("tags", () => {
  const tag = (slugAr: string | null, slugEn: string | null = null) => ({
    slugAr,
    slugEn,
    nameAr: `وسم ${slugAr ?? slugEn ?? ""}`,
  });

  it("creates, renames with a slug_changed redirect, and refuses delete while used", async () => {
    const created = (await (await call("POST", "tags", tag("old"))).json()) as { id: string };
    const renamed = await call("PATCH", `tags/${created.id}`, tag("new"));
    expect(renamed.statusCode, renamed.body).toBe(200);
    const redirects = await ctx.owner.db.select().from(slugRedirects);
    expect(redirects).toMatchObject([
      { fromPath: "/blog/t/old", toPath: "/blog/t/new", reason: "slug_changed" },
    ]);

    const item = await makeItem();
    await ctx.owner.db.insert(contentItemTags).values({ itemId: item.id, tagId: created.id });
    const blocked = await call("DELETE", `tags/${created.id}`);
    expect(blocked.json()).toMatchObject({ code: "CONTENT_IN_USE", details: { itemCount: 1 } });
    expect((await call("POST", "tags", tag(null, null))).statusCode).toBe(400);
  });

  it("merges in one transaction without duplicates and redirects the merged tag pages", async () => {
    const from = (await (await call("POST", "tags", tag("from", "from-en"))).json()) as {
      id: string;
    };
    const into = (await (await call("POST", "tags", tag("into", "into-en"))).json()) as {
      id: string;
    };
    const both = await makeItem();
    const onlyFrom = await makeItem();
    await ctx.owner.db.insert(contentItemTags).values([
      { itemId: both.id, tagId: from.id },
      { itemId: both.id, tagId: into.id },
      { itemId: onlyFrom.id, tagId: from.id },
    ]);

    const res = await call("POST", "tags/merge", { fromId: from.id, intoId: into.id });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: into.id, itemCount: 2 });
    expect(
      await ctx.owner.db.select().from(contentTags).where(eq(contentTags.id, from.id)),
    ).toHaveLength(0);
    const links = await ctx.owner.db.select().from(contentItemTags);
    expect(links.every((row) => row.tagId === into.id)).toBe(true);
    const redirects = (await ctx.owner.db.select().from(slugRedirects)).map((row) => [
      row.fromPath,
      row.toPath,
      row.reason,
    ]);
    expect(redirects).toEqual(
      expect.arrayContaining([
        ["/blog/t/from", "/blog/t/into", "merged"],
        ["/en/blog/t/from-en", "/en/blog/t/into-en", "merged"],
      ]),
    );
    expect(
      (await call("POST", "tags/merge", { fromId: into.id, intoId: into.id })).statusCode,
    ).toBe(400);
    expect(await auditActions()).toContain("content.tag.merge");
  });
});

describe("people", () => {
  it("returns the licence to admins but never audits it", async () => {
    const person = await makePerson("dr-a", "both");
    const list = (await call("GET", "people")).json() as {
      items: { licenceNumber: string | null }[];
    };
    expect(list.items[0]?.licenceNumber).toBe("EG-SECRET-1");
    const audits = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "content.person.create"));
    expect(JSON.stringify(audits)).not.toContain("EG-SECRET-1");
    expect(audits[0]?.targetId).toBe(person.id);
  });

  it("keeps slugs and account links unique and the account real", async () => {
    await makePerson("dr-b", "author");
    expect(
      (await call("POST", "people", { slug: "dr-b", nameAr: "x", role: "author" })).json(),
    ).toMatchObject({
      code: "CONTENT_SLUG_TAKEN",
    });
    expect(
      (
        await call("POST", "people", {
          slug: "dr-c",
          nameAr: "x",
          role: "reviewer",
          userId: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
    await makePerson("dr-d", "reviewer", admin.userId);
    expect(
      (
        await call("POST", "people", {
          slug: "dr-e",
          nameAr: "x",
          role: "reviewer",
          userId: admin.userId,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("refuses author-only for a default reviewer and delete while referenced", async () => {
    const reviewer = await makePerson("dr-f", "reviewer");
    await makeCategory("rev-cat", { defaultReviewerId: reviewer.id });
    const demote = await call("PATCH", `people/${reviewer.id}`, {
      slug: "dr-f",
      nameAr: "x",
      role: "author",
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toMatchObject({ code: "CONTENT_IN_USE" });
    expect((await call("DELETE", `people/${reviewer.id}`)).json()).toMatchObject({
      code: "CONTENT_IN_USE",
    });

    const author = await makePerson("dr-g", "author");
    await makeItem({ primaryAuthorId: author.id });
    expect((await call("DELETE", `people/${author.id}`)).statusCode).toBe(409);
    const free = await makePerson("dr-h", "author");
    expect((await call("DELETE", `people/${free.id}`)).statusCode).toBe(204);
  });
});

describe("redirects", () => {
  const redirect = (fromPath: string, toPath: string) => ({ fromPath, toPath });

  it("creates, tests the chain, and refuses chains and duplicates", async () => {
    expect((await call("POST", "redirects", redirect("/a", "/b"))).statusCode).toBe(201);
    // /b becomes a source: the existing /a -> /b is repointed to /c instead of forming a chain.
    expect((await call("POST", "redirects", redirect("/b", "/c"))).statusCode).toBe(201);
    // A new redirect may not point at a path that is itself redirected.
    const chain = await call("POST", "redirects", redirect("/x", "/a"));
    expect(chain.statusCode).toBe(422);
    expect(chain.json()).toMatchObject({ code: "CONTENT_REDIRECT_INVALID" });
    expect((await call("POST", "redirects", redirect("/y", "/b"))).json()).toMatchObject({
      code: "CONTENT_REDIRECT_INVALID",
    });
    expect((await call("POST", "redirects", redirect("/a", "/z"))).json()).toMatchObject({
      code: "CONTENT_SLUG_TAKEN",
    });

    const trace = redirectTestResponseSchema.parse(
      (await call("GET", "redirects/test?path=/a")).json(),
    );
    expect(trace).toEqual({ finalPath: "/c", chain: ["/c"], loop: false });
  });

  it("collapses existing redirects that pointed at the new source", async () => {
    await call("POST", "redirects", redirect("/old", "/mid"));
    const res = await call("POST", "redirects", redirect("/mid", "/final"));
    expect(res.statusCode, res.body).toBe(201);
    const rows = await ctx.owner.db.select().from(slugRedirects);
    expect(rows.find((row) => row.fromPath === "/old")?.toPath).toBe("/final");
  });

  it("updates, deletes, lists and audits", async () => {
    const created = (await (await call("POST", "redirects", redirect("/p", "/q"))).json()) as {
      id: string;
    };
    const updated = await call("PATCH", `redirects/${created.id}`, redirect("/p", "/r"));
    expect(updated.statusCode, updated.body).toBe(200);
    const list = (await call("GET", "redirects?q=/p")).json() as {
      items: { toPath: string }[];
      nextCursor: string | null;
    };
    expect(list.items[0]?.toPath).toBe("/r");
    expect((await call("DELETE", `redirects/${created.id}`)).statusCode).toBe(204);
    expect((await call("DELETE", `redirects/${created.id}`)).statusCode).toBe(404);
    expect(await auditActions()).toEqual(
      expect.arrayContaining([
        "content.redirect.create",
        "content.redirect.update",
        "content.redirect.delete",
      ]),
    );
    expect(
      (await call("POST", "redirects", redirect("https://evil.example", "/x"))).statusCode,
    ).toBe(400);
  });
});

describe("options", () => {
  it("splits people into authors and reviewers and carries the category reviewer", async () => {
    const author = await makePerson("o-author", "author");
    const reviewer = await makePerson("o-reviewer", "reviewer");
    const both = await makePerson("o-both", "both");
    await makeCategory("o-cat", { defaultReviewerId: reviewer.id });
    await call("POST", "tags", { slugAr: "o-tag", nameAr: "وسم" });

    const options = contentOptionsSchema.parse((await call("GET", "options")).json());
    expect(options.authors.map((row) => row.id).sort()).toEqual([author.id, both.id].sort());
    expect(options.reviewers.map((row) => row.id).sort()).toEqual([reviewer.id, both.id].sort());
    expect(options.categories[0]?.defaultReviewer?.id).toBe(reviewer.id);
    expect(options.tags).toHaveLength(1);
  });
});

describe("bulk", () => {
  it("sets category and tags per item and reports unknown ids", async () => {
    const cat = await makeCategory("bulk-cat");
    const tagA = (await (await call("POST", "tags", { slugAr: "ta", nameAr: "أ" })).json()) as {
      id: string;
    };
    const tagB = (await (await call("POST", "tags", { slugAr: "tb", nameAr: "ب" })).json()) as {
      id: string;
    };
    const one = await makeItem();
    const two = await makeItem();

    const res = await call("POST", "bulk", {
      action: "set_category",
      ids: [one.id, MISSING_ID, two.id],
      categoryId: cat.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(bulkResultSchema.parse(res.json()).results).toEqual([
      { id: one.id, ok: true },
      { id: MISSING_ID, ok: false, code: "NOT_FOUND" },
      { id: two.id, ok: true },
    ]);
    const rows = await ctx.owner.db
      .select()
      .from(contentItems)
      .where(eq(contentItems.categoryId, cat.id));
    expect(rows).toHaveLength(2);

    await call("POST", "bulk", {
      action: "set_tags",
      ids: [one.id],
      mode: "add",
      tagIds: [tagA.id, tagB.id],
    });
    await call("POST", "bulk", {
      action: "set_tags",
      ids: [one.id],
      mode: "remove",
      tagIds: [tagA.id],
    });
    const links = await ctx.owner.db
      .select()
      .from(contentItemTags)
      .where(eq(contentItemTags.itemId, one.id));
    expect(links.map((row) => row.tagId)).toEqual([tagB.id]);

    expect(await auditActions()).toContain("content.bulk");
    const bulkAudit = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "content.bulk"));
    expect(
      bulkAudit.find((row) => (row.after as { action?: string }).action === "set_category")?.after,
    ).toMatchObject({
      action: "set_category",
      ids: [one.id, MISSING_ID, two.id],
    });
  });

  it("only accepts an active reviewer as set_reviewer target and caps the id list", async () => {
    const author = await makePerson("b-author", "author");
    const item = await makeItem();
    expect(
      (
        await call("POST", "bulk", {
          action: "set_reviewer",
          ids: [item.id],
          reviewerId: author.id,
        })
      ).statusCode,
    ).toBe(400);
    const reviewer = await makePerson("b-reviewer", "reviewer");
    expect(
      (
        await call("POST", "bulk", {
          action: "set_reviewer",
          ids: [item.id],
          reviewerId: reviewer.id,
        })
      ).statusCode,
    ).toBe(200);
    const tooMany = Array.from({ length: 101 }, () => randomUUID());
    expect((await call("POST", "bulk", { action: "unpublish", ids: tooMany })).statusCode).toBe(
      400,
    );
  });

  // schedule_series / unpublish / archive go through ContentBulkPort. They are covered once the
  // port is bound to ContentWorkflowService (see TaxonomyModule); until then each item answers
  // UPSTREAM_UNAVAILABLE and schedulability is checked first.
  it("reports an item that cannot be scheduled with its own code", async () => {
    const draft = await makeItem();
    const res = await call("POST", "bulk", {
      action: "schedule_series",
      ids: [draft.id],
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      everyHours: 6,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(bulkResultSchema.parse(res.json()).results[0]).toMatchObject({
      id: draft.id,
      ok: false,
    });
  });
});

describe("review inbox", () => {
  it("lists items in review oldest first and narrows to mine", async () => {
    const me = await makePerson("i-me", "reviewer", admin.userId);
    const other = await makePerson("i-other", "reviewer");
    const reviewerCtx = await ctx.admin("admin");
    const older = await makeItem({
      status: "in_review",
      reviewerId: me.id,
      updatedAt: new Date("2030-01-01T00:00:00Z"),
    });
    const newer = await makeItem({
      status: "in_review",
      reviewerId: other.id,
      updatedAt: new Date("2030-01-02T00:00:00Z"),
    });
    await makeItem({ status: "draft" });

    const all = reviewInboxResponseSchema.parse((await call("GET", "review-inbox")).json());
    expect(all.items.map((row) => row.id)).toEqual([older.id, newer.id]);

    const mine = reviewInboxResponseSchema.parse(
      (await call("GET", "review-inbox?mine=true")).json(),
    );
    expect(mine.items.map((row) => row.id)).toEqual([older.id]);

    // An account without a linked person has nothing of its own.
    const none = reviewInboxResponseSchema.parse(
      (await call("GET", "review-inbox?mine=true", undefined, reviewerCtx)).json(),
    );
    expect(none.items).toEqual([]);
  });
});

describe("link suggestions", () => {
  it("returns live items of the same locale, not the item itself", async () => {
    const current = await makeItem({ title: "السكري" });
    const target = await makeItem({ title: "علاج السكري", slug: "diabetes-care" }, { live: true });
    await makeItem({ title: "علاج السكري بالإنجليزية", locale: "en" }, { live: true });
    await makeItem({ title: "علاج السكري مسودة" });

    const res = await call("GET", `link-suggestions?itemId=${current.id}&q=السكري&locale=ar`);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { items: { path: string }[] }).items.map((row) => row.path)).toEqual([
      `/blog/${target.slug}`,
    ]);
    expect(
      (await call("GET", `link-suggestions?itemId=${MISSING_ID}&q=a&locale=ar`)).statusCode,
    ).toBe(404);
  });
});

describe("media admin extension", () => {
  it("lists where an asset is used and patches the new metadata", async () => {
    const [asset] = await ctx.owner.db
      .insert(mediaAssets)
      .values({ sha256: "a".repeat(64), status: "ready" })
      .returning();
    if (asset === undefined) throw new Error("no asset");
    const item = await makeItem({ title: "مقال بصورة" });
    await ctx.owner.db
      .insert(contentMediaRefs)
      .values({ itemId: item.id, mediaId: asset.id, role: "featured" });

    const usage = mediaUsageResponseSchema.parse(
      (await ctx.harness.call("GET", `/admin/media/${asset.id}/usage`, { jar: admin.jar })).json(),
    );
    expect(usage.items).toEqual([
      { id: item.id, type: "article", title: "مقال بصورة", role: "featured" },
    ]);
    expect(
      (await ctx.harness.call("GET", `/admin/media/${MISSING_ID}/usage`, { jar: admin.jar }))
        .statusCode,
    ).toBe(404);

    const patch = (body: Record<string, unknown>) =>
      ctx.harness.call("PATCH", `/admin/media/${asset.id}`, { jar: admin.jar, body });
    const ok = await patch({ caption: "كوب شاي", licence: "ai-generated", seoFilename: "tea-cup" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({
      licence: "ai-generated",
      seoFilename: "tea-cup",
      usageCount: 1,
    });
    expect((await patch({ licence: "cc-by" })).statusCode).toBe(400);
    expect((await patch({ licence: "cc-by", credit: "Jane" })).statusCode).toBe(200);
  });
});
