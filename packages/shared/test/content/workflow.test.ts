import { describe, expect, it } from "vitest";

import {
  CONTENT_ACTIONS,
  CONTENT_STATUSES,
  type ContentAction,
  type ContentStatus,
} from "../../src/content/constants.js";
import {
  WORKFLOW_ERROR_CODES,
  allowedActions,
  localDayBounds,
  planPublishDue,
  requiresMedicalReview,
  statusAfterNewRevision,
  transition,
  type TransitionInput,
  type WorkflowActor,
  type WorkflowItem,
} from "../../src/content/workflow.js";

const NOW = new Date("2026-03-10T10:00:00Z");
const FUTURE = new Date("2026-03-11T10:00:00Z");
const PAST = new Date("2026-03-09T10:00:00Z");

function item(overrides: Partial<WorkflowItem> = {}): WorkflowItem {
  return {
    status: "draft",
    live: false,
    requiresReview: true,
    currentRevisionId: "rev-2",
    reviewedRevisionId: null,
    submittedBy: null,
    submittedRevisionAuthorId: null,
    scheduledAt: null,
    ...overrides,
  };
}

function actor(permissions: string[], overrides: Partial<WorkflowActor> = {}): WorkflowActor {
  return {
    userId: "user-actor",
    permissions: new Set(permissions),
    isActiveReviewer: false,
    ...overrides,
  };
}

const ALL = [
  "content.read",
  "content.write",
  "content.publish",
  "content.review",
  "content.manage",
];
const reviewer = actor(ALL, { isActiveReviewer: true });

function input(overrides: Partial<TransitionInput> = {}): TransitionInput {
  return {
    now: NOW,
    at: FUTURE,
    comment: "needs a source",
    gatesPass: true,
    hasEdits: false,
    ...overrides,
  };
}

const PERMISSION: Record<ContentAction, string> = {
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

/** The state-machine table of CONTENT-PLATFORM §11.2: what a fully privileged, conflict-free actor reaches. */
function expected(
  status: ContentStatus,
  action: ContentAction,
  review: boolean,
  live: boolean,
): ContentStatus | "REVIEW_NOT_REQUIRED" | null {
  switch (action) {
    case "submit":
      if (status !== "draft") return null;
      return review ? "in_review" : "REVIEW_NOT_REQUIRED";
    case "approve":
      return status === "in_review" ? "approved" : null;
    case "request_changes":
      return status === "in_review" ? "draft" : null;
    case "schedule":
      return status === "approved" || (status === "draft" && !review) ? "scheduled" : null;
    case "publish":
      return status === "approved" || status === "scheduled" || (status === "draft" && !review)
        ? "published"
        : null;
    case "unschedule":
      return status === "scheduled" ? (review ? "approved" : "draft") : null;
    case "unpublish":
      return live && (status === "published" || status === "draft") ? "draft" : null;
    case "archive":
      return status === "archived" ? null : "archived";
    case "unarchive":
      return status === "archived" ? "draft" : null;
  }
}

describe("requiresMedicalReview", () => {
  it("follows §11.2: guides and glossary always, pages never, articles by category", () => {
    expect(requiresMedicalReview({ type: "guide", categoryRequiresReview: false })).toBe(true);
    expect(requiresMedicalReview({ type: "glossary", categoryRequiresReview: false })).toBe(true);
    expect(requiresMedicalReview({ type: "page", categoryRequiresReview: true })).toBe(false);
    expect(requiresMedicalReview({ type: "article", categoryRequiresReview: true })).toBe(true);
    expect(requiresMedicalReview({ type: "article", categoryRequiresReview: false })).toBe(false);
    expect(requiresMedicalReview({ type: "article", categoryRequiresReview: null })).toBe(true);
  });
});

describe("transition: every status x action x actor", () => {
  const actors: Record<string, WorkflowActor> = {
    nobody: actor([]),
    readOnly: actor(["content.read"]),
    writer: actor(["content.read", "content.write"]),
    publisher: actor(["content.read", "content.publish"]),
    reviewerPermissionOnly: actor(["content.review"]),
    reviewer,
    manager: actor(["content.manage"]),
    all: actor(ALL, { isActiveReviewer: true }),
  };

  it("forbids an actor without the action's permission, in every state", () => {
    for (const status of CONTENT_STATUSES) {
      for (const action of CONTENT_ACTIONS) {
        for (const [name, who] of Object.entries(actors)) {
          if (who.permissions.has(PERMISSION[action])) continue;
          const result = transition(item({ status, live: true }), who, action, input());
          expect(result, `${status}/${action}/${name}`).toEqual({ ok: false, code: "FORBIDDEN" });
        }
      }
    }
  });

  it("matches the §11.2 table for a fully privileged actor", () => {
    for (const review of [true, false]) {
      for (const live of [false, true]) {
        for (const status of CONTENT_STATUSES) {
          for (const action of CONTENT_ACTIONS) {
            const target = expected(status, action, review, live);
            const subject = item({
              status,
              live,
              requiresReview: review,
              reviewedRevisionId: review ? "rev-2" : null,
              submittedBy: "someone-else",
              submittedRevisionAuthorId: "author-else",
              scheduledAt: status === "scheduled" ? FUTURE : null,
            });
            const result = transition(subject, actors["all"] as WorkflowActor, action, input());
            const label = `${status}/${action}/review=${String(review)}/live=${String(live)}`;
            if (target === null) {
              expect(result, label).toEqual({ ok: false, code: "ILLEGAL_TRANSITION" });
            } else if (target === "REVIEW_NOT_REQUIRED") {
              expect(result, label).toEqual({ ok: false, code: "REVIEW_NOT_REQUIRED" });
            } else {
              expect(result.ok, label).toBe(true);
              if (result.ok) expect(result.status, label).toBe(target);
            }
          }
        }
      }
    }
  });

  it("only ever returns documented error codes", () => {
    const seen = new Set<string>();
    for (const status of CONTENT_STATUSES) {
      for (const action of CONTENT_ACTIONS) {
        for (const who of Object.values(actors)) {
          for (const gatesPass of [true, false]) {
            const result = transition(
              item({ status, live: true }),
              who,
              action,
              input({ gatesPass }),
            );
            if (!result.ok) seen.add(result.code);
          }
        }
      }
    }
    for (const code of seen) expect(WORKFLOW_ERROR_CODES).toContain(code);
  });
});

describe("transition: rules", () => {
  it("submit records the submission and needs content.write", () => {
    const result = transition(item(), actor(["content.write"]), "submit", input());
    expect(result).toMatchObject({
      ok: true,
      status: "in_review",
      effects: { recordSubmission: true },
    });
  });

  it("refuses submit for items that skip review", () => {
    expect(
      transition(item({ requiresReview: false }), actor(["content.write"]), "submit", input()),
    ).toEqual({
      ok: false,
      code: "REVIEW_NOT_REQUIRED",
    });
  });

  it("approve needs an active reviewer profile, not just the permission", () => {
    const inReview = item({
      status: "in_review",
      submittedBy: "writer",
      submittedRevisionAuthorId: "writer",
    });
    expect(transition(inReview, actor(["content.review"]), "approve", input())).toEqual({
      ok: false,
      code: "NOT_A_REVIEWER",
    });
    const approved = transition(inReview, reviewer, "approve", input());
    expect(approved).toMatchObject({
      ok: true,
      status: "approved",
      effects: { setReviewedRevision: "current", createRevisionFromEdits: false },
    });
  });

  it("four-eyes: the submitter and the revision author cannot approve", () => {
    const base = {
      status: "in_review" as const,
      submittedBy: "u-submitter",
      submittedRevisionAuthorId: "u-author",
    };
    for (const userId of ["u-submitter", "u-author"]) {
      const me = actor(ALL, { userId, isActiveReviewer: true });
      expect(transition(item(base), me, "approve", input())).toEqual({
        ok: false,
        code: "FOUR_EYES",
      });
      expect(transition(item(base), me, "approve", input({ hasEdits: true }))).toEqual({
        ok: false,
        code: "FOUR_EYES",
      });
    }
    const independent = actor(ALL, { userId: "u-other", isActiveReviewer: true });
    expect(transition(item(base), independent, "approve", input()).ok).toBe(true);
  });

  it("four-eyes treats an API-created revision (no author user) as having no conflict", () => {
    const subject = item({
      status: "in_review",
      submittedBy: null,
      submittedRevisionAuthorId: null,
    });
    expect(transition(subject, reviewer, "approve", input()).ok).toBe(true);
  });

  it("approve with minor edits creates the reviewer's revision and approves it", () => {
    const result = transition(
      item({ status: "in_review", submittedBy: "w" }),
      reviewer,
      "approve",
      input({ hasEdits: true }),
    );
    expect(result).toMatchObject({
      ok: true,
      status: "approved",
      effects: { createRevisionFromEdits: true, setReviewedRevision: "current" },
    });
  });

  it("request_changes needs a comment and returns the item to draft", () => {
    const inReview = item({ status: "in_review" });
    for (const comment of [undefined, "", "   "]) {
      expect(transition(inReview, reviewer, "request_changes", input({ comment }))).toEqual({
        ok: false,
        code: "COMMENT_REQUIRED",
      });
    }
    expect(transition(inReview, reviewer, "request_changes", input())).toMatchObject({
      ok: true,
      status: "draft",
    });
    expect(transition(inReview, actor(["content.review"]), "request_changes", input())).toEqual({
      ok: false,
      code: "NOT_A_REVIEWER",
    });
  });

  it("schedule needs a future instant", () => {
    const approved = item({ status: "approved", reviewedRevisionId: "rev-2" });
    expect(transition(approved, reviewer, "schedule", input({ at: PAST }))).toEqual({
      ok: false,
      code: "SCHEDULE_IN_PAST",
    });
    expect(transition(approved, reviewer, "schedule", input({ at: NOW }))).toEqual({
      ok: false,
      code: "SCHEDULE_IN_PAST",
    });
    expect(transition(approved, reviewer, "schedule", input({ at: undefined }))).toEqual({
      ok: false,
      code: "SCHEDULE_IN_PAST",
    });
    expect(transition(approved, reviewer, "schedule", input())).toMatchObject({
      ok: true,
      status: "scheduled",
      effects: { setScheduledAt: FUTURE, setPublishedRevision: "keep" },
    });
  });

  it("publishing serves exactly the approved revision", () => {
    const stale = item({
      status: "approved",
      reviewedRevisionId: "rev-1",
      currentRevisionId: "rev-2",
    });
    expect(transition(stale, reviewer, "publish", input())).toEqual({
      ok: false,
      code: "NOT_APPROVED_REVISION",
    });
    expect(transition(stale, reviewer, "schedule", input())).toEqual({
      ok: false,
      code: "NOT_APPROVED_REVISION",
    });
    const never = item({ status: "approved", reviewedRevisionId: null });
    expect(transition(never, reviewer, "publish", input())).toEqual({
      ok: false,
      code: "NOT_APPROVED_REVISION",
    });
    const fine = item({ status: "approved", reviewedRevisionId: "rev-2" });
    expect(transition(fine, reviewer, "publish", input())).toMatchObject({
      ok: true,
      status: "published",
      effects: { setPublishedRevision: "current", clearScheduledAt: true },
    });
  });

  it("failing block gates stop schedule and publish only", () => {
    const approved = item({ status: "approved", reviewedRevisionId: "rev-2" });
    expect(transition(approved, reviewer, "publish", input({ gatesPass: false }))).toEqual({
      ok: false,
      code: "GATES_BLOCK",
    });
    expect(transition(approved, reviewer, "schedule", input({ gatesPass: false }))).toEqual({
      ok: false,
      code: "GATES_BLOCK",
    });
    expect(transition(approved, reviewer, "archive", input({ gatesPass: false })).ok).toBe(true);
  });

  it("items without review publish straight from draft, still behind the gates", () => {
    const draft = item({ requiresReview: false });
    expect(transition(draft, reviewer, "publish", input()).ok).toBe(true);
    expect(transition(draft, reviewer, "publish", input({ gatesPass: false }))).toEqual({
      ok: false,
      code: "GATES_BLOCK",
    });
    expect(transition(item(), reviewer, "publish", input())).toEqual({
      ok: false,
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("publishing a scheduled item is how the worker publishes it", () => {
    const scheduled = item({
      status: "scheduled",
      reviewedRevisionId: "rev-2",
      scheduledAt: FUTURE,
    });
    expect(transition(scheduled, reviewer, "publish", input())).toMatchObject({
      ok: true,
      status: "published",
      effects: { clearScheduledAt: true },
    });
    // Scheduling twice is not allowed: unschedule first.
    expect(transition(scheduled, reviewer, "schedule", input())).toEqual({
      ok: false,
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("unschedule returns to approved when review is required and to draft otherwise", () => {
    expect(
      transition(item({ status: "scheduled" }), reviewer, "unschedule", input()),
    ).toMatchObject({
      status: "approved",
      effects: { clearScheduledAt: true },
    });
    expect(
      transition(
        item({ status: "scheduled", requiresReview: false }),
        reviewer,
        "unschedule",
        input(),
      ),
    ).toMatchObject({ status: "draft" });
  });

  it("unpublish clears the live pointer and needs a live item", () => {
    expect(
      transition(item({ status: "published", live: true }), reviewer, "unpublish", input()),
    ).toMatchObject({
      ok: true,
      status: "draft",
      effects: { setPublishedRevision: "clear" },
    });
    // A live item whose working copy was edited back to draft can be unpublished too.
    expect(
      transition(item({ status: "draft", live: true }), reviewer, "unpublish", input()).ok,
    ).toBe(true);
    expect(
      transition(item({ status: "draft", live: false }), reviewer, "unpublish", input()),
    ).toEqual({
      ok: false,
      code: "ILLEGAL_TRANSITION",
    });
  });

  it("archive clears live and schedule; unarchive returns a draft; both need content.manage", () => {
    expect(
      transition(item({ status: "scheduled", live: true }), reviewer, "archive", input()),
    ).toMatchObject({
      status: "archived",
      effects: { setPublishedRevision: "clear", clearScheduledAt: true },
    });
    expect(transition(item({ status: "archived" }), reviewer, "unarchive", input())).toMatchObject({
      status: "draft",
    });
    expect(
      transition(item({ status: "archived" }), actor(["content.publish"]), "unarchive", input()),
    ).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("is a pure function: inputs are not mutated and the same call gives the same answer", () => {
    const subject = item({ status: "approved", reviewedRevisionId: "rev-2" });
    const snapshot = structuredClone(subject);
    const first = transition(subject, reviewer, "schedule", input());
    expect(transition(subject, reviewer, "schedule", input())).toEqual(first);
    expect(subject).toEqual(snapshot);
  });
});

describe("allowedActions", () => {
  it("lists exactly the actions transition would accept", () => {
    for (const review of [true, false]) {
      for (const status of CONTENT_STATUSES) {
        const subject = item({
          status,
          live: true,
          requiresReview: review,
          reviewedRevisionId: "rev-2",
          submittedBy: "other",
        });
        const listed = allowedActions(subject, reviewer, true, NOW);
        const direct = CONTENT_ACTIONS.filter(
          (action) => transition(subject, reviewer, action, input()).ok,
        );
        expect(listed, `${status}/${String(review)}`).toEqual(direct);
      }
    }
  });

  it("offers a writer only submit on a reviewed draft, and nothing on an archived item", () => {
    const writer = actor(["content.read", "content.write"]);
    expect(allowedActions(item(), writer, true, NOW)).toEqual(["submit"]);
    expect(allowedActions(item({ status: "archived" }), writer, true, NOW)).toEqual([]);
  });

  it("hides publish and schedule while a block gate fails", () => {
    const approved = item({ status: "approved", reviewedRevisionId: "rev-2" });
    expect(allowedActions(approved, reviewer, true, NOW)).toContain("publish");
    const blocked = allowedActions(approved, reviewer, false, NOW);
    expect(blocked).not.toContain("publish");
    expect(blocked).not.toContain("schedule");
    expect(blocked).toContain("archive");
  });
});

describe("statusAfterNewRevision", () => {
  it("returns to draft, drops the schedule and keeps the live revision", () => {
    for (const status of ["draft", "in_review", "approved", "scheduled", "published"] as const) {
      expect(statusAfterNewRevision({ status, live: true })).toEqual({
        status: "draft",
        clearScheduledAt: true,
        keepLive: true,
      });
    }
    expect(statusAfterNewRevision({ status: "approved", live: false }).keepLive).toBe(false);
  });

  it("leaves an archived item archived", () => {
    expect(statusAfterNewRevision({ status: "archived", live: false })).toMatchObject({
      status: "archived",
    });
  });
});

describe("planPublishDue (daily cap)", () => {
  const at = (hour: number): Date => new Date(Date.UTC(2026, 2, 10, hour));
  const due = [
    { id: "c", scheduledAt: at(9) },
    { id: "a", scheduledAt: at(7) },
    { id: "e", scheduledAt: at(11) },
    { id: "b", scheduledAt: at(8) },
    { id: "d", scheduledAt: at(10) },
  ];

  it("publishes in scheduled order up to the cap and defers the rest", () => {
    expect(planPublishDue({ due, publishedToday: 0, cap: 3 })).toEqual({
      publishNow: ["a", "b", "c"],
      deferred: ["d", "e"],
    });
  });

  it("counts what was already published today", () => {
    expect(planPublishDue({ due, publishedToday: 2, cap: 3 })).toEqual({
      publishNow: ["a"],
      deferred: ["b", "c", "d", "e"],
    });
  });

  it("defers everything at or over the cap and never goes negative", () => {
    expect(planPublishDue({ due, publishedToday: 3, cap: 3 }).publishNow).toEqual([]);
    expect(planPublishDue({ due, publishedToday: 9, cap: 3 }).publishNow).toEqual([]);
    expect(planPublishDue({ due: [], publishedToday: 0, cap: 3 })).toEqual({
      publishNow: [],
      deferred: [],
    });
  });

  it("rolls the deferred items into the next day in the same order", () => {
    const day1 = planPublishDue({ due, publishedToday: 0, cap: 2 });
    expect(day1.deferred).toEqual(["c", "d", "e"]);
    const remaining = due.filter((entry) => day1.deferred.includes(entry.id));
    const day2 = planPublishDue({ due: remaining, publishedToday: 0, cap: 2 });
    expect(day2).toEqual({ publishNow: ["c", "d"], deferred: ["e"] });
    const day3 = planPublishDue({
      due: remaining.filter((entry) => day2.deferred.includes(entry.id)),
      publishedToday: 0,
      cap: 2,
    });
    expect(day3).toEqual({ publishNow: ["e"], deferred: [] });
  });

  it("breaks ties between equal schedules by id so the order is stable", () => {
    const tied = [
      { id: "z", scheduledAt: at(7) },
      { id: "m", scheduledAt: at(7) },
    ];
    expect(planPublishDue({ due: tied, publishedToday: 0, cap: 1 })).toEqual({
      publishNow: ["m"],
      deferred: ["z"],
    });
  });
});

describe("localDayBounds", () => {
  const hours = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / 3_600_000;

  it("bounds a plain Cairo winter day at local midnights", () => {
    const { start, end } = localDayBounds(new Date("2026-01-15T10:00:00Z"), "Africa/Cairo");
    expect(start.toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-15T22:00:00.000Z");
  });

  it("puts a late-evening instant in the next UTC day into the right local day", () => {
    // 23:30 UTC is already 01:30 the next day in Cairo (UTC+2).
    const { start, end } = localDayBounds(new Date("2026-01-15T23:30:00Z"), "Africa/Cairo");
    expect(start.toISOString()).toBe("2026-01-15T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-16T22:00:00.000Z");
  });

  it("includes the instant, and consecutive days tile the timeline across both 2026 DST changes", () => {
    let previousEnd: Date | null = null;
    const lengths = new Set<number>();
    for (let day = 0; day < 366; day += 1) {
      const noon = new Date(Date.UTC(2026, 0, 1 + day, 12));
      const { start, end } = localDayBounds(noon, "Africa/Cairo");
      expect(start.getTime()).toBeLessThanOrEqual(noon.getTime());
      expect(noon.getTime()).toBeLessThan(end.getTime());
      if (previousEnd !== null) expect(start.getTime()).toBe(previousEnd.getTime());
      lengths.add(hours(start, end));
      previousEnd = end;
    }
    expect([...lengths].sort()).toEqual([23, 24, 25]);
  });

  it("is DST-safe: the spring-forward day is 23 hours and the fall-back day is 25", () => {
    // Egypt: DST starts the last Friday of April (clocks jump at midnight) and ends the last Thursday of October.
    const spring = localDayBounds(new Date("2026-04-24T12:00:00Z"), "Africa/Cairo");
    expect(hours(spring.start, spring.end)).toBe(23);
    const autumn = localDayBounds(new Date("2026-10-29T12:00:00Z"), "Africa/Cairo");
    expect(hours(autumn.start, autumn.end)).toBe(25);
    // The day after the change starts exactly where the changed day ended.
    const next = localDayBounds(new Date("2026-10-30T12:00:00Z"), "Africa/Cairo");
    expect(next.start.getTime()).toBe(autumn.end.getTime());
  });

  it("works for other zones and for UTC", () => {
    const utc = localDayBounds(new Date("2026-06-15T13:45:10Z"), "UTC");
    expect(utc.start.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(utc.end.toISOString()).toBe("2026-06-16T00:00:00.000Z");
    const riyadh = localDayBounds(new Date("2026-06-15T13:45:10Z"), "Asia/Riyadh");
    expect(riyadh.start.toISOString()).toBe("2026-06-14T21:00:00.000Z");
  });
});
