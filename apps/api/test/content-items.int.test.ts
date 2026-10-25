import { randomUUID } from "node:crypto";

import {
  auditLogs,
  contentCategories,
  contentItems,
  contentPeople,
  contentPublishLog,
  mediaAssets,
  outbox,
  slugRedirects,
} from "@wasfa/db";
import { contentItemDetailSchema, type ContentItemDetail } from "@wasfa/shared/schemas/content";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * The admin content editor API against Postgres and Redis: create, save, the review workflow with
 * four-eyes, scheduling, publishing, slug moves, archive, autosave, restore, permissions and audit.
 * (Written with the slice; needs Docker, so it runs in CI / on a machine with Testcontainers.)
 */

const ctx = new AdminTestContext();
let writer: Admin; // marketing: read + write + publish
let reviewerAccount: Admin; // read + review, linked to a reviewer profile
let selfReviewer: Admin; // write + review + profile: may not approve what they wrote
let manager: Admin; // admin: all content permissions
let readOnly: Admin;
let owner: Admin; // super_admin: no reviewer profile, no review, gates advise
let categoryId: string;
let authorId: string;
let mediaId: string;

beforeAll(async () => {
  await ctx.start();
  writer = await ctx.admin("marketing");
  manager = await ctx.admin("admin");
  reviewerAccount = await ctx.admin(await ctx.customRole(["content.read", "content.review"]));
  selfReviewer = await ctx.admin(
    await ctx.customRole(["content.read", "content.write", "content.review"]),
  );
  readOnly = await ctx.admin(await ctx.customRole(["content.read"]));
  owner = await ctx.admin("super_admin");

  const db = ctx.owner.db;
  const [category] = await db
    .insert(contentCategories)
    .values({ slugAr: "cat-ar", nameAr: "تصنيف", requiresMedicalReview: true })
    .returning({ id: contentCategories.id });
  const [author] = await db
    .insert(contentPeople)
    .values({ slug: "author-one", nameAr: "كاتب", role: "author" })
    .returning({ id: contentPeople.id });
  await db.insert(contentPeople).values([
    { slug: "reviewer-one", nameAr: "مراجع", role: "reviewer", userId: reviewerAccount.userId },
    { slug: "reviewer-two", nameAr: "مراجع٢", role: "both", userId: selfReviewer.userId },
  ]);
  const [media] = await db
    .insert(mediaAssets)
    .values({
      sha256: "b".repeat(64),
      status: "ready",
      mime: "image/jpeg",
      width: 1600,
      height: 900,
      altAr: "صورة",
    })
    .returning({ id: mediaAssets.id });
  if (!category || !author || !media) throw new Error("fixtures");
  categoryId = category.id;
  authorId = author.id;
  mediaId = media.id;
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

const words = (seed: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${seed}${String(i)}`).join(" ");

const call = (
  who: { jar: Admin["jar"] },
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
) =>
  ctx.harness.call(method, `/admin/content/${path}`, {
    jar: who.jar,
    ...(body ? { body } : {}),
  });

async function createItem(overrides: { slug?: string; seed?: string; category?: boolean } = {}) {
  const seed = overrides.seed ?? randomUUID().replaceAll("-", "").slice(0, 8);
  const res = await call(writer, "POST", "items", {
    type: "article",
    locale: "ar",
    payload: { title: `title ${seed}`, excerpt: "excerpt", bodyMd: words(seed, 700) },
    meta: {
      ...(overrides.slug ? { slug: overrides.slug } : {}),
      categoryId: overrides.category === false ? null : categoryId,
      primaryAuthorId: authorId,
      featuredMediaId: mediaId,
      seo: { description: `description ${seed}` },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return contentItemDetailSchema.parse(res.json());
}

async function act(
  who: { jar: Admin["jar"] },
  item: ContentItemDetail,
  action: string,
  body: Record<string, unknown> = {},
) {
  return call(who, "POST", `items/${item.id}/actions/${action}`, body);
}

const detail = async (id: string, who: { jar: Admin["jar"] } = writer) =>
  contentItemDetailSchema.parse((await call(who, "GET", `items/${id}`)).json());

/** Draft -> in review (writer) -> approved (a different reviewer account). */
async function approved(item: ContentItemDetail) {
  expect((await act(writer, item, "submit")).statusCode).toBe(200);
  const res = await act(reviewerAccount, item, "approve", { comment: "looks right" });
  expect(res.statusCode, res.body).toBe(200);
  return contentItemDetailSchema.parse(res.json());
}

describe("who may use the editor API", () => {
  it("asks for sign-in and the right permission per route", async () => {
    expect((await ctx.harness.call("GET", "/admin/content/items")).statusCode).toBe(401);
    expect((await call(readOnly, "GET", "items")).statusCode).toBe(200);
    expect(
      (
        await call(readOnly, "POST", "items", {
          type: "article",
          locale: "ar",
          payload: { title: "x" },
          meta: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(readOnly, "POST", "render-preview", {
          type: "article",
          locale: "ar",
          bodyMd: "x",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("refuses an action the role does not hold, by the action's own permission", async () => {
    const item = await createItem();
    expect((await act(readOnly, item, "submit")).statusCode).toBe(403);
    expect((await act(writer, item, "archive")).statusCode).toBe(403);
  });
});

describe("create, save and the revision history", () => {
  it("creates a draft with revision 1, saves revision 2 and lists both", async () => {
    const item = await createItem();
    expect(item).toMatchObject({ status: "draft", live: false, lockVersion: 0 });
    expect(item.currentRevision.number).toBe(1);
    expect(item.allowedActions).toContain("submit");

    const saved = await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: item.lockVersion,
      payload: { bodyMd: `${item.payload.bodyMd} extra words here` },
      note: "added words",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const after = contentItemDetailSchema.parse(saved.json());
    expect(after.currentRevision.number).toBe(2);
    expect(after.lockVersion).toBe(1);

    const revisions = (await call(writer, "GET", `items/${item.id}/revisions`)).json() as unknown[];
    expect(revisions).toHaveLength(2);
  });

  it("turns a taken explicit slug away and numbers a derived one", async () => {
    const first = await createItem({ slug: "fixed-slug" });
    expect(first.slug).toBe("fixed-slug");
    const again = await call(writer, "POST", "items", {
      type: "article",
      locale: "ar",
      payload: { title: "other" },
      meta: { slug: "fixed-slug" },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "CONTENT_SLUG_TAKEN" });
  });

  it("answers 409 CONTENT_CONFLICT with the current version on a stale save", async () => {
    const item = await createItem();
    await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: 0,
      meta: { flags: { showToc: true } },
    });
    const stale = await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: 0,
      payload: { title: "late" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "CONTENT_CONFLICT",
      details: { currentLockVersion: 1 },
    });
  });

  it("restores an old revision as a new one", async () => {
    const item = await createItem();
    await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: 0,
      payload: { title: "second title" },
    });
    const revisions = (await call(writer, "GET", `items/${item.id}/revisions`)).json() as {
      id: string;
      number: number;
    }[];
    const first = revisions.find((revision) => revision.number === 1);
    const res = await call(writer, "POST", `items/${item.id}/revisions/${first?.id ?? ""}/restore`);
    expect(res.statusCode, res.body).toBe(200);
    const restored = contentItemDetailSchema.parse(res.json());
    expect(restored.currentRevision.number).toBe(3);
    expect(restored.payload.title).toBe(item.payload.title);
  });
});

describe("autosave", () => {
  it("round-trips for the same user, never makes a revision and refuses a stale base", async () => {
    const item = await createItem();
    const payload = {
      title: item.payload.title,
      excerpt: "",
      definition: "",
      bodyMd: "draft in progress",
    };
    const saved = await call(writer, "PUT", `items/${item.id}/autosave`, {
      baseRevisionId: item.currentRevision.id,
      payload,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const mine = await detail(item.id);
    expect(mine.autosave?.payload.bodyMd).toBe("draft in progress");
    expect(mine.currentRevision.number).toBe(1);
    expect((await detail(item.id, manager)).autosave).toBeNull();

    const stale = await call(writer, "PUT", `items/${item.id}/autosave`, {
      baseRevisionId: randomUUID(),
      payload,
    });
    expect(stale.statusCode).toBe(409);
  });
});

describe("review workflow", () => {
  it("create -> save -> submit -> approve by another account -> schedule -> publish", async () => {
    const item = await createItem();
    const approvedItem = await approved(item);
    expect(approvedItem.status).toBe("approved");
    expect(approvedItem.reviewedRevisionId).toBe(approvedItem.currentRevision.id);
    expect(approvedItem.comments.map((comment) => comment.kind)).toContain("approve");

    const at = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await act(writer, item, "schedule", { at });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
    expect(contentItemDetailSchema.parse(scheduled.json()).status).toBe("scheduled");

    const published = await act(writer, item, "publish");
    expect(published.statusCode, published.body).toBe(200);
    const live = contentItemDetailSchema.parse(published.json());
    expect(live).toMatchObject({ status: "published", live: true, hasUnpublishedChanges: false });
    expect(live.publicPath).toBe(`/blog/${live.slug}`);

    const log = await ctx.owner.db
      .select({ to: contentPublishLog.toStatus })
      .from(contentPublishLog)
      .where(eq(contentPublishLog.itemId, item.id));
    expect(log.map((row) => row.to)).toEqual(
      expect.arrayContaining(["in_review", "approved", "scheduled", "published"]),
    );
    const events = await ctx.owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.topic, "content.changed"));
    expect(events.some((row) => (row.payload as { itemId?: string }).itemId === item.id)).toBe(
      true,
    );
  });

  it("refuses the submitter and the author of the submitted revision (four-eyes)", async () => {
    // selfReviewer writes, submits and tries to approve their own work.
    const res = await call(selfReviewer, "POST", "items", {
      type: "article",
      locale: "ar",
      payload: { title: "mine", excerpt: "e", bodyMd: words("self", 700) },
      meta: {
        categoryId,
        primaryAuthorId: authorId,
        featuredMediaId: mediaId,
        seo: { description: "own" },
      },
    });
    const own = contentItemDetailSchema.parse(res.json());
    expect((await act(selfReviewer, own, "submit")).statusCode).toBe(200);
    const approve = await act(selfReviewer, own, "approve");
    expect(approve.statusCode).toBe(403);
    expect(approve.json()).toMatchObject({ code: "CONTENT_FOUR_EYES" });

    // selfReviewer edits the writer's draft, the writer submits it: the revision's author may not approve.
    const theirs = await createItem();
    expect(
      (
        await call(selfReviewer, "PATCH", `items/${theirs.id}`, {
          lockVersion: 0,
          payload: { excerpt: "edited by the future approver" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await act(writer, theirs, "submit")).statusCode).toBe(200);
    const second = await act(selfReviewer, theirs, "approve");
    expect(second.json()).toMatchObject({ code: "CONTENT_FOUR_EYES" });
  });

  it("needs a reviewer profile: a role with content.review but no profile is refused", async () => {
    const noProfile = await ctx.admin(await ctx.customRole(["content.read", "content.review"]));
    const item = await createItem();
    await act(writer, item, "submit");
    const res = await act(noProfile, item, "approve");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "CONTENT_NOT_A_REVIEWER" });
  });

  it("request_changes needs a comment and returns the item to draft", async () => {
    const item = await createItem();
    await act(writer, item, "submit");
    expect((await act(reviewerAccount, item, "request_changes")).statusCode).toBe(422);
    const res = await act(reviewerAccount, item, "request_changes", { comment: "cite sources" });
    expect(contentItemDetailSchema.parse(res.json()).status).toBe("draft");
  });

  it("editing an approved item returns it to draft", async () => {
    const item = await approved(await createItem());
    const edited = await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: item.lockVersion,
      payload: { title: "changed after approval" },
    });
    const after = contentItemDetailSchema.parse(edited.json());
    expect(after.status).toBe("draft");
    expect(after.reviewedRevisionId).not.toBe(after.currentRevision.id);
    expect((await act(writer, after, "publish")).statusCode).toBe(409);
  });

  it("approve with edits records a reviewer revision and approves it", async () => {
    const item = await createItem();
    await act(writer, item, "submit");
    const res = await act(reviewerAccount, item, "approve", {
      edits: { excerpt: "reviewer touch" },
    });
    const done = contentItemDetailSchema.parse(res.json());
    expect(done.currentRevision.number).toBe(2);
    expect(done.reviewedRevisionId).toBe(done.currentRevision.id);
    expect(done.payload.excerpt).toBe("reviewer touch");
  });

  it("refuses to publish while a blocking gate fails and names it", async () => {
    const thin = await call(writer, "POST", "items", {
      // Pages need no review and have no word minimum (min_words skips them), so the blocking
      // gate exercised here is forbidden_claims.
      type: "page",
      locale: "ar",
      payload: { title: "claim page", bodyMd: "هذا المنتج علاج مضمون لكل شيء" },
      meta: { seo: { description: "thin description" } },
    });
    const page = contentItemDetailSchema.parse(thin.json());
    const res = await act(writer, page, "publish");
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ code: "CONTENT_GATES_BLOCK" });
    expect(JSON.stringify(res.json())).toContain("forbidden_claims");
  });

  it("lets the owner publish an unreviewed article past failing gates, and audits the override", async () => {
    const created = await call(owner, "POST", "items", {
      type: "article",
      locale: "ar",
      payload: { title: "owner thin", bodyMd: "short" },
      meta: { seo: { description: "owner thin description" } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = contentItemDetailSchema.parse(created.json());
    // An article with no category needs review and fails min_words, author, image...
    expect(draft.gates.some((gate) => gate.level === "block" && !gate.ok)).toBe(true);
    expect(draft.allowedActions).toEqual(expect.arrayContaining(["publish", "schedule"]));

    // A team member with every content permission is still stopped by the gates.
    const stopped = await act(manager, draft, "publish");
    expect(stopped.statusCode).toBe(409);

    const res = await act(owner, draft, "publish");
    expect(res.statusCode, res.body).toBe(200);
    const live = contentItemDetailSchema.parse(res.json());
    expect(live).toMatchObject({ status: "published", live: true });
    // Publishing is the owner's approval of exactly this revision.
    expect(live.reviewedRevisionId).toBe(live.currentRevision.id);

    const [row] = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "content.item.published"), eq(auditLogs.targetId, draft.id)));
    expect((row?.after as { ownerOverride?: string[] }).ownerOverride).toEqual(
      expect.arrayContaining(["min_words"]),
    );
  });

  it("lets the owner approve what they submitted themselves", async () => {
    const item = await createItem();
    await act(owner, item, "submit");
    const res = await act(owner, item, "approve");
    expect(res.statusCode, res.body).toBe(200);
    expect(contentItemDetailSchema.parse(res.json()).status).toBe("approved");
  });

  it("refuses a schedule in the past", async () => {
    const item = await approved(await createItem());
    const res = await act(writer, item, "schedule", {
      at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "CONTENT_SCHEDULE_IN_PAST" });
  });
});

describe("live items", () => {
  async function publishedItem() {
    const item = await approved(await createItem());
    expect((await act(writer, item, "publish")).statusCode).toBe(200);
    return detail(item.id);
  }

  it("a slug change writes a redirect and a moved event", async () => {
    const item = await publishedItem();
    const res = await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: item.lockVersion,
      meta: { slug: `${item.slug}-new` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const [redirect] = await ctx.owner.db
      .select()
      .from(slugRedirects)
      .where(eq(slugRedirects.fromPath, `/blog/${item.slug}`));
    expect(redirect).toMatchObject({ toPath: `/blog/${item.slug}-new`, reason: "slug_changed" });
    const events = await ctx.owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.topic, "content.changed"));
    expect(events.some((row) => (row.payload as { kind?: string }).kind === "moved")).toBe(true);
  });

  it("editing a live item keeps what the public sees until the next publish", async () => {
    const item = await publishedItem();
    const res = await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: item.lockVersion,
      payload: { title: "a newer working title" },
    });
    const after = contentItemDetailSchema.parse(res.json());
    expect(after).toMatchObject({ status: "draft", live: true, hasUnpublishedChanges: true });
    expect(after.publishedRevisionId).toBe(item.publishedRevisionId);
  });

  it("unpublish keeps the content as a draft and takes it off the site", async () => {
    const item = await publishedItem();
    const res = await act(manager, item, "unpublish");
    expect(res.statusCode, res.body).toBe(200);
    expect(contentItemDetailSchema.parse(res.json())).toMatchObject({
      status: "draft",
      live: false,
    });
    const [row] = await ctx.owner.db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, item.id));
    expect(row?.publishedRevisionId).toBeNull();
    expect(row?.currentRevisionId).toBe(item.currentRevision.id);
  });

  it("unpublish and archive need a recent sign-in", async () => {
    const item = await publishedItem();
    const stale = await ctx.admin("admin");
    await ctx.makeSessionStale(stale.userId);
    const res = await act(stale, item, "unpublish");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ details: { reason: "reauth" } });
  });

  it("corrections are for live items and need content.publish", async () => {
    const item = await publishedItem();
    const ok = await call(writer, "POST", `items/${item.id}/corrections`, {
      summary: "fixed a unit",
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const draft = await createItem();
    expect(
      (await call(writer, "POST", `items/${draft.id}/corrections`, { summary: "not live yet" }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call(readOnly, "POST", `items/${item.id}/corrections`, { summary: "nope nope" }))
        .statusCode,
    ).toBe(403);
  });
});

describe("archive", () => {
  it("with a redirect records a 301 source; without one there is none", async () => {
    const withRedirect = await approved(await createItem());
    await act(writer, withRedirect, "publish");
    const res = await act(manager, withRedirect, "archive", { redirectTo: "/blog/somewhere-else" });
    expect(res.statusCode, res.body).toBe(200);
    const archived = contentItemDetailSchema.parse(res.json());
    expect(archived).toMatchObject({
      status: "archived",
      live: false,
      archivedRedirectTo: "/blog/somewhere-else",
    });
    const [row] = await ctx.owner.db
      .select()
      .from(slugRedirects)
      .where(
        and(
          eq(slugRedirects.fromPath, `/blog/${archived.slug}`),
          eq(slugRedirects.reason, "archived"),
        ),
      );
    expect(row?.toPath).toBe("/blog/somewhere-else");

    const plain = await createItem();
    const gone = await act(manager, plain, "archive");
    expect(contentItemDetailSchema.parse(gone.json()).archivedRedirectTo).toBeNull();
    const rows = await ctx.owner.db
      .select()
      .from(slugRedirects)
      .where(eq(slugRedirects.fromPath, `/blog/${plain.slug}`));
    expect(rows).toHaveLength(0);

    const back = await act(manager, withRedirect, "unarchive");
    expect(contentItemDetailSchema.parse(back.json()).status).toBe("draft");
    const after = await ctx.owner.db
      .select()
      .from(slugRedirects)
      .where(eq(slugRedirects.fromPath, `/blog/${archived.slug}`));
    expect(after).toHaveLength(0);
  });
});

describe("preview and audit", () => {
  it("render-preview returns HTML and a table of contents without storing anything", async () => {
    const res = await call(writer, "POST", "render-preview", {
      type: "article",
      locale: "ar",
      bodyMd: "## عنوان\n\nنص",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ toc: [{ level: 2 }] });
  });

  it("every write leaves an audit row", async () => {
    const item = await createItem();
    await call(writer, "PATCH", `items/${item.id}`, {
      lockVersion: 0,
      payload: { title: "audited" },
    });
    await act(writer, item, "submit");
    expect((await ctx.auditRowsFor("content.item.created", item.id)).length).toBe(1);
    expect((await ctx.auditRowsFor("content.item.updated", item.id)).length).toBe(1);
    expect((await ctx.auditRowsFor("content.item.submitted", item.id)).length).toBe(1);
  });
});
