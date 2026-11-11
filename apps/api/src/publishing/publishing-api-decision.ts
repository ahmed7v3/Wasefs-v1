import { hasBlockingIssues } from "@wasfa/shared/content";

import type { ContentStatus } from "@wasfa/shared/content/constants";
import type { QualityGate } from "@wasfa/shared/schemas/content";
import type { PublishingDesiredStatus } from "@wasfa/shared/schemas/publishing";

/*
 * What the Publishing API does with `desired_status` (docs/PUBLISHING-API.md §8), as one pure function so
 * the table is testable row by row. It decides; `PublishingApiArticlesService` executes the plan through
 * the existing `ContentWorkflowService`, which re-checks everything under the item lock (gates, caps,
 * review, four-eyes). An API key is never the content owner: nothing here, or downstream, lets a key skip
 * review or a blocking gate.
 */

export interface DecisionInput {
  desired: PublishingDesiredStatus;
  /** The key's `can_publish` AND it holds the `content:publish` scope. */
  canPublish: boolean;
  requiresReview: boolean;
  /** Status of the working copy now (a write returns a changed item to draft; a repeat leaves it as it is). */
  status: ContentStatus;
  /** The request's explicit `publish_on_approval`, when it sent one. */
  publishOnApproval: boolean | undefined;
  /** Gates computed for the revision just written. */
  gates: readonly QualityGate[];
}

export type PublishPlan =
  /** Nothing to run; `publishOnApproval` (when set) is still recorded on an item already in review. */
  | { kind: "none"; notes: string[]; publishOnApproval?: boolean }
  | { kind: "submit"; publishOnApproval: boolean; notes: string[] }
  | { kind: "publish"; notes: string[] }
  | { kind: "schedule"; notes: string[] }
  /** Saved as a draft, not lost; the caller answers 422 (or 409 for a near-duplicate). */
  | { kind: "refuse"; blocking: string[]; notes: string[] };

/** Ids of the failing blocking gates. */
export function blockingIds(
  gates: readonly QualityGate[],
  except: readonly string[] = [],
): string[] {
  return gates
    .filter((gate) => gate.level === "block" && !gate.ok && !except.includes(gate.id))
    .map((gate) => gate.id);
}

export const NOTE = {
  keyCannotPublish:
    "This API key cannot publish (can_publish is off or it lacks the content:publish scope), so nothing went live.",
  reviewNeeded:
    "This category needs medical review: the article was sent to review. A human reviewer must approve this exact revision before it can go live.",
  willPublishOnApproval:
    "publish_on_approval is on: the article will be published automatically when a reviewer approves this revision.",
  noAutoPublish:
    "It will NOT publish by itself after approval: ask to publish (POST /articles/{id}/publish) once it is approved.",
  scheduleAfterApproval:
    "Scheduling needs an approved revision: after the reviewer approves, call POST /articles/{id}/schedule.",
  reviewNotRequired:
    "This category does not need medical review, so there is nothing to submit; the article stays a draft. Ask to publish when it is ready.",
  archived: "This item is archived, so nothing was done. Ask a human to restore it.",
  alreadyInReview: "The article is already in review.",
  alreadyApproved: "The article is already approved by a reviewer.",
  alreadyPublished: "The article is already published.",
  alreadyScheduled: "The article is already scheduled.",
  blocked:
    "Blocking quality issues stop this from going further. The article was saved as a draft: fix the blocking items and send it again.",
} as const;

export function decidePlan(input: DecisionInput): PublishPlan {
  const { desired, canPublish, requiresReview, gates, status } = input;
  // The reviewed revision is the working one: an approved item is ready to go live.
  const approved = status === "approved";

  if (desired === "draft") return { kind: "none", notes: [] };
  if (status === "archived") return { kind: "none", notes: [NOTE.archived] };

  // What stops a revision from being sent anywhere: everything except the review gate, which is
  // exactly what review is for.
  const blockingForReview = blockingIds(gates, ["medical_review"]);
  const blockingNow = blockingIds(gates);

  const submit = (publishOnApproval: boolean, notes: string[]): PublishPlan => {
    const withAuto = [...notes, ...(publishOnApproval ? [NOTE.willPublishOnApproval] : [])];
    if (status === "in_review") {
      // Already with the reviewers: only the auto-publish choice can still change.
      return { kind: "none", publishOnApproval, notes: [NOTE.alreadyInReview, ...withAuto] };
    }
    return blockingForReview.length > 0
      ? { kind: "refuse", blocking: blockingForReview, notes: [NOTE.blocked] }
      : { kind: "submit", publishOnApproval, notes: withAuto };
  };

  const goLive = (): PublishPlan => {
    if (status === "published") return { kind: "none", notes: [NOTE.alreadyPublished] };
    if (hasBlockingIssues(gates)) {
      return { kind: "refuse", blocking: blockingNow, notes: [NOTE.blocked] };
    }
    return desired === "scheduled"
      ? { kind: "schedule", notes: [] }
      : { kind: "publish", notes: [] };
  };

  if (desired === "in_review") {
    if (!requiresReview) return { kind: "none", notes: [NOTE.reviewNotRequired] };
    if (approved) return { kind: "none", notes: [NOTE.alreadyApproved] };
    return submit(input.publishOnApproval === true && canPublish, [NOTE.reviewNeeded]);
  }

  if (!canPublish) {
    // (b) A key that cannot publish still gets its article to the reviewers when review exists.
    if (!requiresReview) return { kind: "none", notes: [NOTE.keyCannotPublish] };
    if (approved) return { kind: "none", notes: [NOTE.keyCannotPublish, NOTE.alreadyApproved] };
    return submit(false, [NOTE.keyCannotPublish, NOTE.reviewNeeded, NOTE.noAutoPublish]);
  }

  if (requiresReview) {
    // (c) Never published without approval: only an approved revision can go live.
    if (approved) return goLive();
    if (desired === "scheduled")
      return submit(false, [NOTE.reviewNeeded, NOTE.scheduleAfterApproval]);
    const auto = input.publishOnApproval ?? true;
    return submit(auto, [NOTE.reviewNeeded, ...(auto ? [] : [NOTE.noAutoPublish])]);
  }

  // (d) Non-medical key that may publish: the gates decide.
  if (status === "scheduled" && desired === "scheduled") {
    return { kind: "none", notes: [NOTE.alreadyScheduled] };
  }
  return goLive();
}

/** The status a plan leads to, for `POST /articles/validate`. */
export function planOutcome(plan: PublishPlan): "draft" | "in_review" | "published" | "scheduled" {
  switch (plan.kind) {
    case "submit":
      return "in_review";
    case "publish":
      return "published";
    case "schedule":
      return "scheduled";
    case "none":
    case "refuse":
      return "draft";
  }
}
