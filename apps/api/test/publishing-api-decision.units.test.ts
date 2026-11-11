import { describe, expect, it } from "vitest";

import {
  blockingIds,
  decidePlan,
  planOutcome,
  type DecisionInput,
} from "../src/publishing/publishing-api-decision.js";

import type { QualityGate } from "@wasfa/shared/schemas/content";

/*
 * docs/PUBLISHING-API.md §8: what `desired_status` becomes for every combination of key right, review
 * rule, status and gates. The workflow (which actually performs it) is tested in
 * publishing-api-workflow.units.test.ts.
 */

const pass: QualityGate[] = [{ id: "required_fields", level: "block", ok: true, params: {} }];
const failing: QualityGate[] = [
  { id: "min_words", level: "block", ok: false, params: { words: 10, min: 600 } },
];
const unreviewed: QualityGate = { id: "medical_review", level: "block", ok: false, params: {} };
const duplicate: QualityGate = {
  id: "duplicate_content",
  level: "block",
  ok: false,
  params: { score: 0.7 },
};

const base: DecisionInput = {
  desired: "published",
  canPublish: true,
  requiresReview: false,
  status: "draft",
  publishOnApproval: undefined,
  gates: pass,
};
const plan = (over: Partial<DecisionInput>) => decidePlan({ ...base, ...over });

describe("draft", () => {
  it("never does anything", () => {
    expect(plan({ desired: "draft", requiresReview: true })).toEqual({ kind: "none", notes: [] });
    expect(plan({ desired: "draft", gates: failing })).toEqual({ kind: "none", notes: [] });
  });
});

describe("(b) key that cannot publish", () => {
  it("non-medical published -> stays a draft and says why", () => {
    const result = plan({ canPublish: false });
    expect(result.kind).toBe("none");
    expect(result.notes.join(" ")).toMatch(/cannot publish/);
    expect(planOutcome(result)).toBe("draft");
  });

  it("medical published -> in_review, never auto-publish, says why", () => {
    const result = plan({ canPublish: false, requiresReview: true, gates: [...pass, unreviewed] });
    expect(result).toMatchObject({ kind: "submit", publishOnApproval: false });
    expect(result.notes.join(" ")).toMatch(/cannot publish/);
    expect(planOutcome(result)).toBe("in_review");
  });

  it("ignores publish_on_approval: a key that cannot publish cannot arrange a publish", () => {
    const result = plan({ canPublish: false, requiresReview: true, publishOnApproval: true });
    expect(result).toMatchObject({ kind: "submit", publishOnApproval: false });
    expect(
      plan({
        desired: "in_review",
        canPublish: false,
        requiresReview: true,
        publishOnApproval: true,
      }),
    ).toMatchObject({
      publishOnApproval: false,
    });
  });

  it("scheduled behaves like published", () => {
    expect(plan({ desired: "scheduled", canPublish: false }).kind).toBe("none");
    expect(plan({ desired: "scheduled", canPublish: false, requiresReview: true }).kind).toBe(
      "submit",
    );
  });
});

describe("(c) medical categories: never published without approval", () => {
  const medical = { requiresReview: true, gates: [...pass, unreviewed] };

  it("published -> in_review with publish_on_approval stored by default", () => {
    const result = plan(medical);
    expect(result).toMatchObject({ kind: "submit", publishOnApproval: true });
    expect(result.notes.join(" ")).toMatch(/automatically/);
  });

  it("an explicit publish_on_approval=false is honoured", () => {
    expect(plan({ ...medical, publishOnApproval: false })).toMatchObject({
      kind: "submit",
      publishOnApproval: false,
    });
  });

  it("scheduled -> in_review without auto-publish (a schedule needs an approved revision)", () => {
    const result = plan({ ...medical, desired: "scheduled" });
    expect(result).toMatchObject({ kind: "submit", publishOnApproval: false });
    expect(result.notes.join(" ")).toMatch(/schedule/i);
  });

  it("in_review -> submits; the review gate itself never blocks the submission", () => {
    expect(plan({ ...medical, desired: "in_review" }).kind).toBe("submit");
  });

  it("other blocking gates stop the submission: the draft is saved, the reviewers are not bothered", () => {
    const result = plan({ ...medical, gates: [...failing, unreviewed] });
    expect(result).toMatchObject({ kind: "refuse", blocking: ["min_words"] });
  });

  it("an approved revision can go live (the human reviewed exactly this revision)", () => {
    expect(plan({ ...medical, status: "approved", gates: pass }).kind).toBe("publish");
    expect(plan({ ...medical, status: "approved", gates: pass, desired: "scheduled" }).kind).toBe(
      "schedule",
    );
  });

  it("an approved revision with a failing gate is refused, not published", () => {
    expect(plan({ ...medical, status: "approved", gates: failing }).kind).toBe("refuse");
  });

  it("already in review: nothing to run, only the auto-publish choice is recorded", () => {
    expect(plan({ ...medical, status: "in_review", publishOnApproval: true })).toMatchObject({
      kind: "none",
      publishOnApproval: true,
    });
  });
});

describe("(d) non-medical key that may publish", () => {
  it("published when the gates pass", () => {
    expect(plan({})).toMatchObject({ kind: "publish", notes: [] });
    expect(planOutcome(plan({}))).toBe("published");
  });

  it("scheduled when the gates pass", () => {
    expect(plan({ desired: "scheduled" }).kind).toBe("schedule");
  });

  it("refused with the blocking ids when a gate fails (the item is saved as a draft, not lost)", () => {
    expect(plan({ gates: failing })).toMatchObject({ kind: "refuse", blocking: ["min_words"] });
    expect(planOutcome(plan({ gates: failing }))).toBe("draft");
  });

  it("a near-duplicate is a refusal that names the duplicate gate", () => {
    expect(plan({ gates: [duplicate] })).toMatchObject({
      kind: "refuse",
      blocking: ["duplicate_content"],
    });
  });

  it("warnings never block", () => {
    const warn: QualityGate = { id: "headings", level: "warn", ok: false, params: {} };
    expect(plan({ gates: [...pass, warn] }).kind).toBe("publish");
  });

  it("in_review is not applicable: a draft stays a draft with an explanation", () => {
    const result = plan({ desired: "in_review" });
    expect(result.kind).toBe("none");
    expect(result.notes.join(" ")).toMatch(/does not need medical review/);
  });
});

describe("repeat writes on an item that already moved", () => {
  it("published stays as it is", () => {
    expect(plan({ status: "published" }).kind).toBe("none");
  });
  it("scheduled can be published now, not re-scheduled", () => {
    expect(plan({ status: "scheduled" }).kind).toBe("publish");
    expect(plan({ status: "scheduled", desired: "scheduled" }).kind).toBe("none");
  });
  it("archived does nothing", () => {
    expect(plan({ status: "archived" }).kind).toBe("none");
  });
});

describe("blockingIds", () => {
  it("lists failing block gates only, minus exceptions", () => {
    expect(blockingIds([...failing, unreviewed])).toEqual(["min_words", "medical_review"]);
    expect(blockingIds([...failing, unreviewed], ["medical_review"])).toEqual(["min_words"]);
  });
});
