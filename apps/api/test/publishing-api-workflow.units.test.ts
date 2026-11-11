import { ErrorCode } from "@wasfa/shared/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentWorkflowService } from "../src/content/workflow.service.js";
import { apiActorFor } from "../src/publishing/publishing-api-actor.js";

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
import type { ContentActorCtx } from "../src/content/items.service.js";
import type { PublishingPrincipal } from "../src/publishing/publishing-principal.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { ContentItem } from "@wasfa/db";
import type { ContentAction } from "@wasfa/shared/content/constants";

/*
 * The workflow as the Publishing API drives it (docs/PUBLISHING-API.md §8): the API key is a machine
 * actor that is NEVER the owner, the per-key and global caps answer 429, and a reviewer's approval of an
 * API revision published with `publish_on_approval` publishes it through the normal action.
 */

const KEY = "018f0000-0000-7000-8000-0000000000aa";
const OWNER = "018f0000-0000-7000-8000-0000000000bb";

const principal = (over: Partial<PublishingPrincipal> = {}): PublishingPrincipal => ({
  keyId: KEY,
  keyName: "Agent",
  ownerUserId: OWNER,
  scopes: ["content:read", "content:write", "content:publish"],
  canPublish: true,
  allowedTypes: [],
  allowedCategorySlugs: [],
  defaultAuthorId: null,
  defaultFeaturedMediaId: null,
  dailyPublishCap: null,
  requestsPerMinute: 60,
  ...over,
});

const NON_MEDICAL = {
  id: ids.other,
  nameAr: "تصنيف",
  requiresMedicalReview: false,
  defaultReviewerId: null,
};

function setup(item: ContentItem, options: { gates?: ReturnType<typeof builtFixture> } = {}) {
  const repo = fakeRepo(item, makeRevision());
  const render = { build: vi.fn(() => Promise.resolve(options.gates ?? builtFixture())) };
  const outbox = { kick: vi.fn(() => Promise.resolve()) };
  const service = new ContentWorkflowService(
    repo as unknown as ContentItemsRepo,
    render as unknown as ContentRenderService,
    fakeSettings() as unknown as SettingsService,
    outbox as unknown as OutboxQueue,
  );
  const act = (action: ContentAction, actor: ContentActorCtx, body = {}) =>
    service.act(item.id, action, body, actor);
  return { repo, render, act, service };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("(a) an API key is never the owner", () => {
  /** What a careless or hostile caller might build: a machine actor claiming every owner power. */
  const hostile = (): ContentActorCtx => ({
    ...apiActorFor(principal()),
    permissions: new Set([
      "content.read",
      "content.write",
      "content.publish",
      "content.review",
      "content.manage",
    ]),
    isOwner: true,
    isActiveReviewer: true,
  });

  it("cannot publish an unreviewed medical draft even when the ctx claims to be the owner", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    await expect(act("publish", hostile())).rejects.toMatchObject({
      code: ErrorCode.CONTENT_ILLEGAL_TRANSITION,
    });
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("cannot publish past a blocking gate (the owner's advisory gates do not apply)", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }), {
      gates: builtFixture(blockingGates),
    });
    repo.findCategory.mockResolvedValue(NON_MEDICAL);
    await expect(act("publish", hostile())).rejects.toMatchObject({
      code: ErrorCode.CONTENT_GATES_BLOCK,
    });
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("cannot approve (no reviewer profile, however the ctx is built)", async () => {
    const { act, repo } = setup(makeItem({ status: "in_review", categoryId: ids.other }));
    await expect(act("approve", hostile())).rejects.toMatchObject({
      code: ErrorCode.CONTENT_NOT_A_REVIEWER,
    });
    expect(repo.updateItem).not.toHaveBeenCalled();
  });

  it("cannot publish a medical item whose approval is stale (approval binds to a revision)", async () => {
    const { act } = setup(
      makeItem({ status: "approved", categoryId: ids.other, reviewedRevisionId: ids.rev2 }),
    );
    await expect(act("publish", apiActorFor(principal()))).rejects.toMatchObject({
      code: ErrorCode.CONTENT_NOT_APPROVED,
    });
  });

  it("a key that may not publish has no content.publish permission", async () => {
    const { act } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    const key = apiActorFor(principal({ canPublish: false }));
    await expect(act("publish", key)).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe("a non-medical key publishes through the normal action", () => {
  it("publishes, stamps the publish log with the key, and records the outbox side effects", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    repo.findCategory.mockResolvedValue(NON_MEDICAL);
    const outcome = await act("publish", apiActorFor(principal()));
    expect(outcome).toMatchObject({ from: "draft", to: "published", overridden: [] });
    // publishItemTx moves the pointers, writes the publish log and enqueues `content.changed`
    // (revalidation, sitemap, IndexNow are consumers of that event): it is called with the key as actor.
    expect(repo.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: ids.item,
        actor: { type: "api_key", id: KEY, name: "API key: Agent" },
      }),
    );
  });

  it("submit writes the publish log as the key and records the owner only as submitted_by", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    await act("submit", apiActorFor(principal()));
    expect(repo.insertPublishLog).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "api_key", actorId: KEY, toStatus: "in_review" }),
    );
    const patch = repo.updateItem.mock.calls.at(-1)?.[1] as Partial<ContentItem>;
    expect(patch).toMatchObject({ status: "in_review", submittedBy: OWNER });
  });
});

describe("(e) caps answer 429", () => {
  it("the per-key daily cap (counted from this key's publish log rows)", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    repo.findCategory.mockResolvedValue(NON_MEDICAL);
    repo.countPublishedByKeySince.mockResolvedValue(3);
    const key = apiActorFor(principal({ dailyPublishCap: 3 }));
    await expect(act("publish", key)).rejects.toMatchObject({
      code: ErrorCode.CONTENT_PUBLISH_CAP,
      httpStatus: 429,
      details: { scope: "key" },
    });
    expect(repo.countPublishedByKeySince).toHaveBeenCalledWith(KEY, expect.any(Date));
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("below the per-key cap it publishes", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    repo.findCategory.mockResolvedValue(NON_MEDICAL);
    repo.countPublishedByKeySince.mockResolvedValue(2);
    await act("publish", apiActorFor(principal({ dailyPublishCap: 3 })));
    expect(repo.publish).toHaveBeenCalledTimes(1);
  });

  it("a key without its own cap is bound only by the global cap", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    repo.findCategory.mockResolvedValue(NON_MEDICAL);
    repo.countPublishedByKeySince.mockResolvedValue(999);
    await act("publish", apiActorFor(principal({ dailyPublishCap: null })));
    expect(repo.countPublishedByKeySince).not.toHaveBeenCalled();
  });

  it("the global cap refuses a key with 429 (an editor still gets the editor's 409)", async () => {
    const { act, repo } = setup(makeItem({ status: "draft", categoryId: ids.other }));
    repo.findCategory.mockResolvedValue(NON_MEDICAL);
    repo.countPublishedSince.mockResolvedValue(25);
    await expect(act("publish", apiActorFor(principal()))).rejects.toMatchObject({
      code: ErrorCode.CONTENT_PUBLISH_CAP,
      httpStatus: 429,
      details: { scope: "global" },
    });
    const editor = actorOf(ids.other, ["content.read", "content.publish"]);
    await expect(act("publish", editor)).rejects.toMatchObject({
      code: ErrorCode.CONTENT_PUBLISH_CAP,
      httpStatus: 409,
    });
  });
});

describe("(c) publish_on_approval: the item publishes when a human approves exactly that revision", () => {
  const reviewer = () => actorOf(ids.reviewer, ["content.read", "content.review"], true);

  /** An item an API key wrote and submitted: in review, flagged to publish on approval. */
  const flagged = (flags: Record<string, unknown> = { publishOnApproval: true }) =>
    makeItem({
      status: "in_review",
      categoryId: ids.other,
      source: "api",
      apiKeyId: KEY,
      flags,
      submittedBy: OWNER,
      submittedRevisionId: ids.rev,
    });
  const approvedOf = (item: ContentItem): ContentItem => ({
    ...item,
    status: "approved",
    reviewedRevisionId: ids.rev,
    lockVersion: item.lockVersion + 1,
  });

  /** The repo shows the in-review item until the approval commits, then the approved one. */
  function approvalFlow(
    item: ContentItem,
    options: {
      gates?: ReturnType<typeof builtFixture>;
      revision?: Partial<ReturnType<typeof makeRevision>>;
    } = {},
  ) {
    const ctx = setup(item, options.gates ? { gates: options.gates } : {});
    const approved = approvedOf(item);
    let committed = false;
    ctx.repo.findItem.mockImplementation(() => Promise.resolve(committed ? approved : item));
    ctx.repo.lockItem.mockImplementation(() => Promise.resolve(committed ? approved : item));
    ctx.repo.updateItem.mockImplementation((_id, patch) => {
      if ((patch as Partial<ContentItem>).status === "approved") committed = true;
      return Promise.resolve();
    });
    ctx.repo.findRevision.mockResolvedValue(
      makeRevision({ createdByApiKeyId: KEY, createdByUserId: null, ...options.revision }),
    );
    ctx.repo.revisionAuthor.mockResolvedValue(null);
    return ctx;
  }

  it("approve -> the system publishes on the key's behalf, through the normal publish action", async () => {
    const { act, repo } = approvalFlow(flagged());
    await act("approve", reviewer());
    expect(repo.publish).toHaveBeenCalledTimes(1);
    expect(repo.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: "system", id: `api_key:${KEY}`, name: "System (publish on approval)" },
      }),
    );
  });

  it("uses the same gates: when they fail at that time the item stays approved and the log says why", async () => {
    const { act, repo, render } = approvalFlow(flagged(), { gates: builtFixture(blockingGates) });
    // The approval itself does not evaluate gates; only the publish step does.
    await act("approve", reviewer());
    expect(render.build).toHaveBeenCalled();
    expect(repo.publish).not.toHaveBeenCalled();
    expect(repo.insertPublishLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: "approved",
        toStatus: "approved",
        actorType: "system",
        reason: "publish_on_approval_blocked:CONTENT_GATES_BLOCK",
      }),
    );
  });

  it("honours the key's daily cap snapshot: the item stays approved when the key is out of publishes", async () => {
    const { act, repo } = approvalFlow(
      flagged({ publishOnApproval: true, publishOnApprovalCap: 2 }),
    );
    repo.countPublishedByKeySince.mockResolvedValue(2);
    await act("approve", reviewer());
    expect(repo.publish).not.toHaveBeenCalled();
    expect(repo.insertPublishLog).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "publish_on_approval_blocked:CONTENT_PUBLISH_CAP" }),
    );
  });

  it("does nothing without the flag", async () => {
    const { act, repo } = approvalFlow(flagged({ publishOnApproval: false }));
    await act("approve", reviewer());
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("does nothing when the approved revision is not one the key wrote (a reviewer's edit is theirs to publish)", async () => {
    const { act, repo } = approvalFlow(flagged(), {
      revision: { createdByApiKeyId: null, createdByUserId: ids.reviewer },
    });
    await act("approve", reviewer());
    expect(repo.publish).not.toHaveBeenCalled();
  });

  it("only a reviewer's approval triggers it: no other action does", async () => {
    const { act, repo } = approvalFlow(flagged());
    await act("request_changes", reviewer(), { comment: "fix the dosage section" });
    expect(repo.publish).not.toHaveBeenCalled();
  });
});
