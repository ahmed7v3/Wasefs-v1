import { CONTENT_ACTIONS } from "./constants.js";

import type { ContentAction, ContentStatus, ContentType } from "./constants.js";

/*
 * The editorial state machine (CONTENT-PLATFORM §4 and §11.2) as pure functions: no clock, no
 * database, no framework. The API calls `transition` inside the row-locked transaction and applies
 * the returned `effects`; the worker calls `planPublishDue` to honour the daily cap; the admin UI
 * calls `allowedActions` to draw the buttons. One implementation means a button can never be offered
 * for an action the server would refuse.
 */

/** Review is mandatory for guides and glossary entries, optional per category for articles, never for pages. */
export function requiresMedicalReview(input: {
  type: ContentType;
  categoryRequiresReview: boolean | null;
}): boolean {
  if (input.type === "page") return false;
  if (input.type === "guide" || input.type === "glossary") return true;
  // An article with no category follows its type: review required.
  return input.categoryRequiresReview ?? true;
}

export interface WorkflowItem {
  status: ContentStatus;
  /** `published_revision_id` is set: the public sees (a version of) it. */
  live: boolean;
  requiresReview: boolean;
  currentRevisionId: string;
  reviewedRevisionId: string | null;
  /** Who moved the item into review (`submitted_by`). */
  submittedBy: string | null;
  /** Author of the revision that was submitted; may differ from `submittedBy`. */
  submittedRevisionAuthorId: string | null;
  scheduledAt: Date | null;
}

export interface WorkflowActor {
  userId: string;
  permissions: ReadonlySet<string>;
  /** The account is linked to an active `content_people` reviewer profile. */
  isActiveReviewer: boolean;
}

export const WORKFLOW_ERROR_CODES = [
  "FORBIDDEN",
  "ILLEGAL_TRANSITION",
  "FOUR_EYES",
  "NOT_A_REVIEWER",
  "COMMENT_REQUIRED",
  "SCHEDULE_IN_PAST",
  "REVIEW_NOT_REQUIRED",
  "NOT_APPROVED_REVISION",
  "GATES_BLOCK",
] as const;
export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export interface TransitionInput {
  comment?: string | undefined;
  /** `schedule`: the instant to publish at. */
  at?: Date | undefined;
  now: Date;
  /** No failing `block` gate on the revision being published. */
  gatesPass: boolean;
  /** `approve`: the reviewer supplied minor edits that become a reviewer-authored revision. */
  hasEdits?: boolean | undefined;
}

export interface TransitionEffects {
  setPublishedRevision: "current" | "keep" | "clear";
  setReviewedRevision: "current" | "keep" | "clear";
  clearScheduledAt: boolean;
  setScheduledAt: Date | null;
  /** Store `submitted_by` / `submitted_revision_id` on the item. */
  recordSubmission: boolean;
  /** Create the reviewer's revision from `edits` BEFORE applying `'current'` pointers. */
  createRevisionFromEdits: boolean;
}

export type TransitionResult =
  | { ok: true; status: ContentStatus; effects: TransitionEffects }
  | { ok: false; code: WorkflowErrorCode };

const PERMISSION_FOR_ACTION: Record<ContentAction, string> = {
  submit: "content.write",
  approve: "content.review",
  request_changes: "content.review",
  schedule: "content.publish",
  unschedule: "content.publish",
  publish: "content.publish",
  unpublish: "content.publish",
  archive: "content.manage",
  unarchive: "content.manage",
};

const NO_EFFECTS: TransitionEffects = {
  setPublishedRevision: "keep",
  setReviewedRevision: "keep",
  clearScheduledAt: false,
  setScheduledAt: null,
  recordSubmission: false,
  createRevisionFromEdits: false,
};

const fail = (code: WorkflowErrorCode): TransitionResult => ({ ok: false, code });
const ok = (status: ContentStatus, effects: Partial<TransitionEffects>): TransitionResult => ({
  ok: true,
  status,
  effects: { ...NO_EFFECTS, ...effects },
});

/**
 * Applies one action. Check order is fixed so the code is predictable for the UI and the tests:
 * permission, then state, then actor rules (reviewer, four-eyes), then input, then content gates.
 * `super_admin` arrives with its expanded permission set; this module has no wildcard of its own.
 */
export function transition(
  item: WorkflowItem,
  actor: WorkflowActor,
  action: ContentAction,
  input: TransitionInput,
): TransitionResult {
  if (!actor.permissions.has(PERMISSION_FOR_ACTION[action])) return fail("FORBIDDEN");

  switch (action) {
    case "submit": {
      if (item.status !== "draft") return fail("ILLEGAL_TRANSITION");
      if (!item.requiresReview) return fail("REVIEW_NOT_REQUIRED");
      return ok("in_review", { recordSubmission: true });
    }

    case "approve": {
      if (item.status !== "in_review") return fail("ILLEGAL_TRANSITION");
      if (!actor.isActiveReviewer) return fail("NOT_A_REVIEWER");
      if (actor.userId === item.submittedBy || actor.userId === item.submittedRevisionAuthorId) {
        return fail("FOUR_EYES");
      }
      return ok("approved", {
        setReviewedRevision: "current",
        createRevisionFromEdits: input.hasEdits === true,
      });
    }

    case "request_changes": {
      if (item.status !== "in_review") return fail("ILLEGAL_TRANSITION");
      if (!actor.isActiveReviewer) return fail("NOT_A_REVIEWER");
      if ((input.comment ?? "").trim() === "") return fail("COMMENT_REQUIRED");
      return ok("draft", {});
    }

    case "schedule":
    case "publish": {
      const fromDraft = item.status === "draft" && !item.requiresReview;
      const fromReviewed = item.status === "approved";
      // Publishing a scheduled item is how the worker (and an impatient editor) publishes it now.
      const fromScheduled = item.status === "scheduled" && action === "publish";
      if (!fromDraft && !fromReviewed && !fromScheduled) return fail("ILLEGAL_TRANSITION");
      if (
        action === "schedule" &&
        (input.at === undefined || input.at.getTime() <= input.now.getTime())
      ) {
        return fail("SCHEDULE_IN_PAST");
      }
      // Approval binds to a revision: an edit after approval moved the item to draft, but guard anyway.
      if (item.requiresReview && item.reviewedRevisionId !== item.currentRevisionId) {
        return fail("NOT_APPROVED_REVISION");
      }
      if (!input.gatesPass) return fail("GATES_BLOCK");
      if (action === "schedule") {
        return ok("scheduled", { setScheduledAt: input.at ?? null });
      }
      return ok("published", { setPublishedRevision: "current", clearScheduledAt: true });
    }

    case "unschedule": {
      if (item.status !== "scheduled") return fail("ILLEGAL_TRANSITION");
      return ok(item.requiresReview ? "approved" : "draft", { clearScheduledAt: true });
    }

    case "unpublish": {
      if (!item.live || (item.status !== "published" && item.status !== "draft")) {
        return fail("ILLEGAL_TRANSITION");
      }
      return ok("draft", { setPublishedRevision: "clear", clearScheduledAt: true });
    }

    case "archive": {
      if (item.status === "archived") return fail("ILLEGAL_TRANSITION");
      return ok("archived", { setPublishedRevision: "clear", clearScheduledAt: true });
    }

    case "unarchive": {
      if (item.status !== "archived") return fail("ILLEGAL_TRANSITION");
      return ok("draft", {});
    }
  }
}

/**
 * The actions this actor may take right now, in `CONTENT_ACTIONS` order, for drawing buttons.
 * Inputs the user has not typed yet (a comment, a date) are assumed valid; the server re-checks.
 */
export function allowedActions(
  item: WorkflowItem,
  actor: WorkflowActor,
  gatesPass: boolean,
  now: Date = new Date(),
): ContentAction[] {
  const farFuture = new Date(now.getTime() + 365 * 24 * 3_600_000);
  return CONTENT_ACTIONS.filter(
    (action) =>
      transition(item, actor, action, {
        now,
        at: farFuture,
        comment: "x",
        gatesPass,
        hasEdits: false,
      }).ok,
  );
}

/**
 * A new revision (any save) returns the working copy to `draft` and drops a pending schedule; the
 * live revision is untouched so the public keeps seeing it (CONTENT-PLATFORM §11.1). An archived
 * item stays archived.
 */
export function statusAfterNewRevision(item: Pick<WorkflowItem, "status" | "live">): {
  status: ContentStatus;
  clearScheduledAt: boolean;
  keepLive: boolean;
} {
  return {
    status: item.status === "archived" ? "archived" : "draft",
    clearScheduledAt: item.status !== "archived",
    keepLive: item.live,
  };
}

/**
 * Splits due scheduled items into those that publish now and those that wait for the next day, in
 * scheduled order, so a cap of 25 with 40 due publishes the 25 oldest schedules first.
 */
export function planPublishDue(input: {
  due: readonly { id: string; scheduledAt: Date }[];
  publishedToday: number;
  cap: number;
}): { publishNow: string[]; deferred: string[] } {
  const ordered = [...input.due].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id),
  );
  const room = Math.max(0, input.cap - input.publishedToday);
  return {
    publishNow: ordered.slice(0, room).map((item) => item.id),
    deferred: ordered.slice(room).map((item) => item.id),
  };
}

/** Parts of an instant on a wall clock in `timeZone`. */
function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` reads `year-month-day 00:00`. */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Two passes settle the offset even when it changes between the guess and the real midnight (DST).
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  instant = guess - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * Start (inclusive) and end (exclusive) of the local calendar day containing `now`, for the daily
 * publishing cap. A day with a DST change is 23 or 25 hours long, which is why the bounds come from
 * the zone's own midnights instead of "+24 h".
 */
export function localDayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const p = zonedParts(now, timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  // Next calendar day via UTC arithmetic on the date part only, which handles month/year rollover.
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end };
}
