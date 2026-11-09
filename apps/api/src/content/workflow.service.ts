import { Injectable } from "@nestjs/common";
import { type ContentItem } from "@wasfa/db";
import {
  contentPath,
  hasBlockingIssues,
  localDayBounds,
  requiresMedicalReview,
  transition,
  type TransitionResult,
  type WorkflowErrorCode,
  type WorkflowItem,
} from "@wasfa/shared/content";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  contentFlagsSchema,
  qualityGateSchema,
  type ContentActionBody,
  type QualityGate,
} from "@wasfa/shared/schemas/content";

import { OutboxQueue } from "../common/outbox-queue.js";
import { SettingsService } from "../settings/settings.service.js";

import { ContentRenderService } from "./content-render.service.js";
import { ContentItemsRepo } from "./items.repo.js";
import {
  appendRevision,
  kickOutbox,
  metaOf,
  stampOf,
  type ContentActorCtx,
} from "./items.service.js";

import type { ContentAction, ContentStatus } from "@wasfa/shared/content/constants";

const DAY_MS = 86_400_000;

/** `WORKFLOW_ERROR_CODES` of the shared state machine -> the API's error codes. */
export const WORKFLOW_TO_ERROR: Record<WorkflowErrorCode, ErrorCode> = {
  FORBIDDEN: ErrorCode.FORBIDDEN,
  ILLEGAL_TRANSITION: ErrorCode.CONTENT_ILLEGAL_TRANSITION,
  FOUR_EYES: ErrorCode.CONTENT_FOUR_EYES,
  NOT_A_REVIEWER: ErrorCode.CONTENT_NOT_A_REVIEWER,
  COMMENT_REQUIRED: ErrorCode.CONTENT_COMMENT_REQUIRED,
  SCHEDULE_IN_PAST: ErrorCode.CONTENT_SCHEDULE_IN_PAST,
  REVIEW_NOT_REQUIRED: ErrorCode.CONTENT_REVIEW_NOT_REQUIRED,
  NOT_APPROVED_REVISION: ErrorCode.CONTENT_NOT_APPROVED,
  GATES_BLOCK: ErrorCode.CONTENT_GATES_BLOCK,
};

function refusal(result: Extract<TransitionResult, { ok: false }>): AppError {
  return new AppError(WORKFLOW_TO_ERROR[result.code]);
}

/** The daily cap refusal; to an API key it is a 429 (retry tomorrow), to a person the editor's 409. */
function capError(actor: ContentActorCtx, scope: "global" | "key"): AppError {
  return new AppError(ErrorCode.CONTENT_PUBLISH_CAP, {
    ...(actor.machine ? { httpStatus: 429 } : {}),
    details: { scope },
  });
}

/** What a reviewer's approval makes of a medical item whose key asked for `published`, if anything. */
const AUTO_PUBLISH_REASON = "publish_on_approval";

function conflict(item: Pick<ContentItem, "lockVersion" | "currentRevisionId"> | undefined) {
  return new AppError(ErrorCode.CONTENT_CONFLICT, {
    details: {
      currentLockVersion: item?.lockVersion ?? 0,
      currentRevisionId: item?.currentRevisionId ?? null,
    },
  });
}

/**
 * Editorial actions (CONTENT-PLATFORM §11.2). The pure state machine decides; this service gathers
 * its inputs, renders what must be rendered BEFORE the transaction (a render needs pool connections
 * and must not hold the item lock), then re-checks under `FOR UPDATE` and applies state, publish
 * log, review comment, redirect and outbox event in one transaction.
 */
@Injectable()
export class ContentWorkflowService {
  constructor(
    private readonly repo: ContentItemsRepo,
    private readonly render: ContentRenderService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxQueue,
  ) {}

  async act(
    itemId: string,
    action: ContentAction,
    body: ContentActionBody,
    callerActor: ContentActorCtx,
  ): Promise<{ from: ContentStatus; to: ContentStatus; overridden: string[] }> {
    // A machine actor (API key, or the system acting for one) is never the owner and never a reviewer:
    // whatever the caller put in the ctx, the owner bypasses of review, four-eyes and gates cannot apply.
    const actor: ContentActorCtx = callerActor.machine
      ? { ...callerActor, isOwner: false, isActiveReviewer: false }
      : callerActor;
    const now = new Date();
    const item = await this.repo.findItem(itemId);
    if (!item?.currentRevisionId) throw new AppError(ErrorCode.NOT_FOUND);
    if (body.lockVersion !== undefined && body.lockVersion !== item.lockVersion) {
      throw conflict(item);
    }
    const [settings, category, current, submitter] = await Promise.all([
      this.settings.get("content"),
      item.categoryId ? this.repo.findCategory(item.categoryId) : undefined,
      this.repo.findRevision(itemId, item.currentRevisionId),
      item.submittedRevisionId ? this.repo.revisionAuthor(item.submittedRevisionId) : null,
    ]);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);

    const workflowItem = (row: ContentItem): WorkflowItem => ({
      status: row.status,
      live: row.publishedRevisionId !== null,
      requiresReview: requiresMedicalReview({
        type: row.type,
        categoryRequiresReview: category?.requiresMedicalReview ?? null,
      }),
      currentRevisionId: row.currentRevisionId ?? "",
      reviewedRevisionId: row.reviewedRevisionId,
      submittedBy: row.submittedBy,
      submittedRevisionAuthorId: submitter,
      scheduledAt: row.scheduledAt,
    });
    const edits = body.edits;
    const hasEdits =
      edits !== undefined && Object.values(edits).some((value) => value !== undefined);
    const input = {
      comment: body.comment,
      at: body.at === undefined ? undefined : new Date(body.at),
      now,
      hasEdits,
    };

    // 1. Permission, state, actor and input rules (gates are checked below with fresh facts).
    const first = transition(workflowItem(item), actor, action, { ...input, gatesPass: true });
    if (!first.ok) throw refusal(first);

    const path = contentPath(item.type, item.locale, item.slug);
    if (action === "archive" && body.redirectTo === path) {
      throw new AppError(ErrorCode.CONTENT_REDIRECT_INVALID);
    }

    // 2. Fresh gates before schedule / publish.
    let freshGates: QualityGate[] | null = null;
    const overridden: string[] = [];
    if (action === "schedule" || action === "publish") {
      const built = await this.render.build({
        itemId: item.id,
        translationGroupId: item.translationGroupId,
        type: item.type,
        locale: item.locale,
        payload: {
          title: current.title,
          excerpt: current.excerpt,
          definition: current.definition,
          bodyMd: current.bodyMd,
        },
        meta: metaOf(item),
        categoryRequiresReview: category?.requiresMedicalReview ?? null,
        approvedMatchesCurrent: item.reviewedRevisionId === item.currentRevisionId,
      });
      freshGates = built.gates;
      if (hasBlockingIssues(built.gates) && actor.isOwner === true) {
        // The owner decides: failing gates are advice. What was overridden goes to the audit log.
        overridden.push(
          ...built.gates
            .filter((gate) => gate.level === "block" && !gate.ok)
            .map((gate) => gate.id),
        );
      } else if (hasBlockingIssues(built.gates)) {
        throw new AppError(ErrorCode.CONTENT_GATES_BLOCK, {
          details: {
            gates: built.gates
              .filter((gate) => gate.level === "block" && !gate.ok)
              .map((gate) => gate.id),
          },
        });
      }
    }

    // 3. The reviewer's minor edits become a revision of their own, approved below.
    let editedBuild: Awaited<ReturnType<ContentRenderService["build"]>> | null = null;
    let editedPayload = {
      title: current.title,
      excerpt: current.excerpt,
      definition: current.definition,
      bodyMd: current.bodyMd,
    };
    if (action === "approve" && hasEdits && edits) {
      editedPayload = {
        title: edits.title ?? current.title,
        excerpt: edits.excerpt ?? current.excerpt,
        definition: edits.definition ?? current.definition,
        bodyMd: edits.bodyMd ?? current.bodyMd,
      };
      editedBuild = await this.render.build({
        itemId: item.id,
        translationGroupId: item.translationGroupId,
        type: item.type,
        locale: item.locale,
        payload: editedPayload,
        meta: metaOf(item),
        categoryRequiresReview: category?.requiresMedicalReview ?? null,
        approvedMatchesCurrent: true,
      });
    }

    const eventKey = `content.changed:${itemId}:${action}:${String(now.getTime())}`;
    let emitted = false;
    const stamped = stampOf(actor);

    const result = await this.repo.transaction(async (data) => {
      const locked = await data.lockItem(itemId);
      if (
        !locked ||
        locked.lockVersion !== item.lockVersion ||
        locked.status !== item.status ||
        locked.currentRevisionId !== item.currentRevisionId ||
        locked.publishedRevisionId !== item.publishedRevisionId
      ) {
        throw conflict(locked);
      }
      const decided = transition(workflowItem(locked), actor, action, {
        ...input,
        gatesPass: true,
      });
      if (!decided.ok) throw refusal(decided);

      let currentRevisionId = locked.currentRevisionId ?? "";
      let patch: Partial<ContentItem> = {};
      if (editedBuild) {
        const appended = await appendRevision(data, {
          item: locked,
          payload: editedPayload,
          previousBodyMd: current.bodyMd,
          built: editedBuild,
          kind: "approve",
          note: null,
          actor,
          now,
          logStatusChange: false,
        });
        currentRevisionId = appended.revision.id;
        patch = appended.patch;
      }

      const log = (to: ContentStatus) =>
        data.insertPublishLog({
          itemId,
          revisionId: currentRevisionId,
          fromStatus: locked.status,
          toStatus: to,
          actorType: stamped.type,
          actorId: stamped.id,
          actorName: stamped.name,
          reason: null,
          at: now,
        });
      const comment = body.comment?.trim();
      const note = async (kind: "request_changes" | "approve" | "note") => {
        if (comment) {
          await data.insertReviewComment({
            itemId,
            revisionId: currentRevisionId,
            kind,
            comment,
            authorUserId: actor.userId,
            authorName: actor.name,
            now,
          });
        }
      };

      // The owner scheduling or publishing a revision nobody reviewed approves it by doing so: the
      // approval pointer then matches what goes live, which the scheduler and the gates rely on.
      const ownerApproval: Partial<ContentItem> =
        actor.isOwner === true &&
        (action === "schedule" || action === "publish") &&
        workflowItem(locked).requiresReview &&
        locked.reviewedRevisionId !== currentRevisionId
          ? { reviewedRevisionId: currentRevisionId, reviewedAt: now }
          : {};

      switch (action) {
        case "submit":
          patch = {
            ...patch,
            status: "in_review",
            submittedRevisionId: currentRevisionId,
            submittedBy: actor.userId,
          };
          await note("note");
          await log("in_review");
          break;
        case "approve": {
          patch = {
            ...patch,
            status: "approved",
            reviewedRevisionId: currentRevisionId,
            reviewedAt: now,
            nextReviewDue: new Date(now.getTime() + settings.reviewIntervalDays.general * DAY_MS),
          };
          await note("approve");
          await log("approved");
          // The stored review gate moves with the approval (the list counts issues from storage).
          if (!editedBuild) {
            const stored = qualityGateSchema.array().safeParse(current.quality);
            if (stored.success) {
              await data.updateRevisionQuality(
                current.id,
                stored.data.map((gate) =>
                  gate.id === "medical_review" ? { ...gate, ok: true } : gate,
                ),
              );
            }
          }
          break;
        }
        case "request_changes":
          patch = { ...patch, status: "draft" };
          await note("request_changes");
          await log("draft");
          break;
        case "schedule":
          patch = {
            ...patch,
            ...ownerApproval,
            status: "scheduled",
            scheduledAt: input.at ?? null,
          };
          if (freshGates) await data.updateRevisionQuality(current.id, freshGates);
          await log("scheduled");
          break;
        case "unschedule":
          patch = { ...patch, status: decided.status, scheduledAt: null };
          await log(decided.status);
          break;
        case "publish": {
          await data.lockPublishCap();
          const since = localDayBounds(now, settings.timeZone).start;
          if ((await data.countPublishedSince(since)) >= settings.maxPublishesPerDay) {
            // The cap protects the site from a runaway automation; the owner publishing by hand is not one.
            if (actor.isOwner !== true) throw capError(actor, "global");
            overridden.push("daily_cap");
          }
          const keyCap = actor.machine?.dailyPublishCap ?? null;
          if (
            actor.machine !== undefined &&
            keyCap !== null &&
            (await data.countPublishedByKeySince(actor.machine.keyId, since)) >= keyCap
          ) {
            throw capError(actor, "key");
          }
          if (freshGates) await data.updateRevisionQuality(current.id, freshGates);
          // The helper moves the pointers, writes the publish log and the outbox event itself.
          await data.publish({ itemId, actor: stamped, now });
          patch = { ...patch, ...ownerApproval };
          emitted = true;
          break;
        }
        case "unpublish":
          await data.unpublish({ itemId, actor: stamped, now });
          emitted = true;
          break;
        case "archive": {
          patch = {
            ...patch,
            status: "archived",
            publishedRevisionId: null,
            scheduledAt: null,
            archivedAt: now,
            archivedRedirectTo: body.redirectTo ?? null,
          };
          if (body.redirectTo !== undefined) {
            await data.upsertRedirect({
              fromPath: path,
              toPath: body.redirectTo,
              reason: "archived",
              createdBy: actor.userId,
              now,
            });
          }
          if (locked.firstPublishedAt !== null) {
            await data.emit({ itemId, kind: "archived", paths: [], oldPaths: [path] }, eventKey);
            emitted = true;
          }
          await log("archived");
          break;
        }
        case "unarchive":
          patch = { ...patch, status: "draft", archivedAt: null, archivedRedirectTo: null };
          if (await data.deleteArchivedRedirect(path)) {
            await data.emit({ itemId, kind: "redirects", paths: [path], oldPaths: [] }, eventKey);
            emitted = true;
          }
          await log("draft");
          break;
      }

      await data.updateItem(itemId, {
        ...patch,
        lockVersion: locked.lockVersion + 1,
        updatedAt: now,
      });
      return { from: locked.status, to: decided.status, overridden };
    });

    if (emitted) await kickOutbox(this.outbox, eventKey);
    if (action === "approve") await this.publishAfterApproval(itemId);
    return result;
  }

  /**
   * Publishing API `publish_on_approval`: a human reviewer just approved. If the approved revision is
   * the one an API key wrote with that flag, the system publishes it on the key's behalf through the
   * normal `publish` action, so the same gates, caps and side effects apply. If anything refuses, the
   * item stays approved and the publish log says why (the reviewer's approval is never undone).
   */
  private async publishAfterApproval(itemId: string): Promise<void> {
    const item = await this.repo.findItem(itemId);
    if (
      !item?.currentRevisionId ||
      item.status !== "approved" ||
      item.apiKeyId === null ||
      item.reviewedRevisionId !== item.currentRevisionId
    ) {
      return;
    }
    const flags = contentFlagsSchema.safeParse(item.flags);
    if (!flags.success || flags.data.publishOnApproval !== true) return;
    const revision = await this.repo.findRevision(itemId, item.currentRevisionId);
    // Only the revision the key itself wrote qualifies; a reviewer's edited revision is theirs to publish.
    if (revision?.createdByApiKeyId !== item.apiKeyId) return;

    const system: ContentActorCtx = {
      userId: item.apiKeyId,
      name: "System (publish on approval)",
      permissions: new Set(["content.read", "content.publish"]),
      isActiveReviewer: false,
      isOwner: false,
      machine: {
        type: "system",
        keyId: item.apiKeyId,
        dailyPublishCap: flags.data.publishOnApprovalCap ?? null,
      },
    };
    try {
      await this.act(itemId, "publish", {}, system);
    } catch (error) {
      const code = error instanceof AppError ? error.code : "ERROR";
      const stamp = stampOf(system);
      await this.repo.insertPublishLog({
        itemId,
        revisionId: item.currentRevisionId,
        fromStatus: "approved",
        toStatus: "approved",
        actorType: stamp.type,
        actorId: stamp.id,
        actorName: stamp.name,
        reason: `${AUTO_PUBLISH_REASON}_blocked:${code}`,
        at: new Date(),
      });
    }
  }
}
