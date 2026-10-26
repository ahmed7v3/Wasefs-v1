import { describe, expect, it } from "vitest";

import {
  applicableSteps,
  canSubmit,
  evaluate,
  knownSteps,
  phoneSkippable,
  phoneStepPassed,
  type MachineState,
} from "../src/onboarding/onboarding.machine.js";

import type { OnboardingStep } from "@wasfa/shared/identity";

/** A brand-new individual with a verified email and phone verification on offer. */
const fresh = (overrides: Partial<MachineState> = {}): MachineState => ({
  accountType: "individual",
  phoneVerified: false,
  emailVerified: true,
  phoneVerificationAvailable: true,
  completedSteps: [],
  ...overrides,
});

const statuses = (state: MachineState) =>
  Object.fromEntries(evaluate(state).steps.map((entry) => [entry.step, entry.status]));

describe("applicable steps", () => {
  it("an individual never sees the organization step", () => {
    expect(applicableSteps("individual")).toEqual([
      "account_type",
      "phone",
      "name",
      "profession_intent",
      "social_follow",
      "plan_picker",
    ]);
  });

  it("an organization sees every step, in order", () => {
    expect(applicableSteps("organization")).toEqual([
      "account_type",
      "phone",
      "name",
      "organization",
      "profession_intent",
      "social_follow",
      "plan_picker",
    ]);
  });

  it("plan_picker is the last step", () => {
    expect(applicableSteps("individual").at(-1)).toBe("plan_picker");
    expect(applicableSteps("organization").at(-1)).toBe("plan_picker");
  });

  it("only social_follow is optional", () => {
    const optional = evaluate(fresh({ accountType: "organization" }))
      .steps.filter((entry) => entry.optional)
      .map((entry) => entry.step);
    expect(optional).toEqual(["social_follow"]);
  });
});

describe("current step", () => {
  it("starts at account_type", () => {
    const view = evaluate(fresh());
    expect(view.currentStep).toBe("account_type");
    expect(statuses(fresh())).toEqual({
      account_type: "current",
      phone: "pending",
      name: "pending",
      profession_intent: "pending",
      social_follow: "pending",
      plan_picker: "pending",
    });
  });

  it("moves to the first step that is not passed", () => {
    expect(evaluate(fresh({ completedSteps: ["account_type"] })).currentStep).toBe("phone");
  });

  it("is done when every applicable step is passed", () => {
    const completedSteps: OnboardingStep[] = [
      "account_type",
      "name",
      "profession_intent",
      "social_follow",
      "plan_picker",
    ];
    const state = fresh({ phoneVerified: true, completedSteps, followed: true });
    expect(evaluate(state).currentStep).toBe("done");
    expect(Object.values(statuses(state))).toEqual(Array(6).fill("completed"));
  });

  it("answering plan_picker last finishes the wizard", () => {
    const before = fresh({
      phoneVerified: true,
      completedSteps: ["account_type", "name", "profession_intent", "social_follow"],
    });
    expect(evaluate(before).currentStep).toBe("plan_picker");
    expect(
      evaluate({ ...before, completedSteps: [...before.completedSteps, "plan_picker"] })
        .currentStep,
    ).toBe("done");
  });

  it("an organization is not done until its organization step is", () => {
    const completedSteps: OnboardingStep[] = [
      "account_type",
      "name",
      "profession_intent",
      "social_follow",
      "plan_picker",
    ];
    const state = fresh({ accountType: "organization", phoneVerified: true, completedSteps });
    expect(evaluate(state).currentStep).toBe("organization");
    expect(
      evaluate({ ...state, completedSteps: [...completedSteps, "organization"] }).currentStep,
    ).toBe("done");
  });

  it("steps after the current one are pending even when they were answered earlier", () => {
    const state = fresh({ completedSteps: ["account_type", "name"] });
    expect(evaluate(state).currentStep).toBe("phone");
    expect(statuses(state)).toMatchObject({ phone: "current", name: "completed" });
  });
});

describe("the phone step", () => {
  it("is passed by a verified phone", () => {
    const state = fresh({ phoneVerified: true, completedSteps: ["account_type"] });
    expect(statuses(state).phone).toBe("completed");
    expect(evaluate(state).currentStep).toBe("name");
  });

  it("is never passed by being listed in completedSteps", () => {
    const state = fresh({ completedSteps: ["account_type", "phone"] });
    expect(phoneStepPassed(state)).toBe(false);
    expect(evaluate(state).currentStep).toBe("phone");
    expect(statuses(state).phone).toBe("current");
  });

  it("is skipped when verification is unavailable and the email is verified", () => {
    const state = fresh({ phoneVerificationAvailable: false, completedSteps: ["account_type"] });
    expect(phoneSkippable(state)).toBe(true);
    expect(statuses(state).phone).toBe("skipped");
    expect(evaluate(state).currentStep).toBe("name");
  });

  it("is not skippable while verification is available", () => {
    expect(phoneSkippable(fresh())).toBe(false);
  });

  it("is not skippable when the email is not verified either", () => {
    const state = fresh({
      phoneVerificationAvailable: false,
      emailVerified: false,
      completedSteps: ["account_type"],
    });
    expect(phoneSkippable(state)).toBe(false);
    expect(evaluate(state).currentStep).toBe("phone");
  });

  it("a Google account (email already verified) still has to verify a phone before onboarding is done", () => {
    const everythingElse = applicableSteps("individual").filter((step) => step !== "phone");
    const state = fresh({ completedSteps: everythingElse });
    expect(evaluate(state).currentStep).toBe("phone");
    expect(evaluate({ ...state, phoneVerified: true }).currentStep).toBe("done");
  });

  it("a verified phone wins over skipping", () => {
    const state = fresh({ phoneVerificationAvailable: false, phoneVerified: true });
    expect(statuses(state).phone).toBe("completed");
  });
});

describe("social_follow", () => {
  const nearlyDone = (followed?: boolean): MachineState =>
    fresh({
      phoneVerified: true,
      completedSteps: ["account_type", "name", "profession_intent", "social_follow", "plan_picker"],
      followed,
    });

  it("followed: true is completed", () => {
    expect(statuses(nearlyDone(true)).social_follow).toBe("completed");
  });

  it("followed: false is skipped, and the wizard is still done", () => {
    expect(statuses(nearlyDone(false)).social_follow).toBe("skipped");
    expect(evaluate(nearlyDone(false)).currentStep).toBe("done");
  });

  it("without an answer it is the current step", () => {
    const state = fresh({
      phoneVerified: true,
      completedSteps: ["account_type", "name", "profession_intent"],
    });
    expect(evaluate(state).currentStep).toBe("social_follow");
  });
});

describe("finished accounts", () => {
  it("stay done even if the phone step would apply again", () => {
    const state = fresh({
      finished: true,
      completedSteps: ["account_type", "name", "profession_intent", "social_follow", "plan_picker"],
    });
    expect(evaluate(state).currentStep).toBe("done");
    expect(statuses(state).phone).toBe("skipped");
  });
});

describe("canSubmit", () => {
  it("accepts the current step", () => {
    expect(canSubmit(fresh(), "account_type")).toEqual({ ok: true });
    expect(canSubmit(fresh({ completedSteps: ["account_type"] }), "phone")).toEqual({ ok: true });
  });

  it("accepts a step that is already passed (the back button)", () => {
    const state = fresh({ completedSteps: ["account_type", "name"], phoneVerified: true });
    expect(canSubmit(state, "account_type")).toEqual({ ok: true });
    expect(canSubmit(state, "name")).toEqual({ ok: true });
  });

  it("accepts a step that was passed by skipping", () => {
    const state = fresh({ phoneVerificationAvailable: false, completedSteps: ["account_type"] });
    expect(canSubmit(state, "phone")).toEqual({ ok: true });
  });

  it("refuses a step beyond the current one", () => {
    expect(canSubmit(fresh(), "name")).toEqual({ ok: false, reason: "step_out_of_order" });
    expect(canSubmit(fresh({ completedSteps: ["account_type"] }), "plan_picker")).toEqual({
      ok: false,
      reason: "step_out_of_order",
    });
  });

  it("refuses the organization step for an individual", () => {
    const state = fresh({ phoneVerified: true, completedSteps: ["account_type", "name"] });
    expect(canSubmit(state, "organization")).toEqual({
      ok: false,
      reason: "step_not_applicable",
    });
  });

  it("accepts the organization step for an organization once it is reached", () => {
    const state = fresh({
      accountType: "organization",
      phoneVerified: true,
      completedSteps: ["account_type", "name"],
    });
    expect(canSubmit(state, "organization")).toEqual({ ok: true });
    expect(canSubmit(state, "profession_intent")).toEqual({
      ok: false,
      reason: "step_out_of_order",
    });
  });

  it("refuses everything once onboarding is complete", () => {
    const state = fresh({
      phoneVerified: true,
      completedSteps: ["account_type", "name", "profession_intent", "social_follow", "plan_picker"],
    });
    for (const step of ["account_type", "name", "social_follow"] as const) {
      expect(canSubmit(state, step)).toEqual({ ok: false, reason: "onboarding_complete" });
    }
  });
});

describe("knownSteps", () => {
  it("keeps only steps of the closed list, in wizard order", () => {
    expect(knownSteps(["name", "bogus", "account_type"])).toEqual(["account_type", "name"]);
  });
});
