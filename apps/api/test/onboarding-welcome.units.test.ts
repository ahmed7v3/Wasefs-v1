import { onboardingWelcomeSchema } from "@wasfa/shared/schemas/onboarding";
import { describe, expect, it } from "vitest";

import { OnboardingService } from "../src/onboarding/onboarding.service.js";

import type { AuthenticatedUser } from "../src/common/current-user.js";
import type { FastifyRequest } from "fastify";

/* `PUT /onboarding/welcome` against an in-memory repo: same machine, same rules, one call. */

const USER = { id: "u1" } as AuthenticatedUser;
const REQUEST = {} as FastifyRequest;
const ORG = { name: "صيدلية النور", type: "pharmacy", country: "EG" } as const;

interface Options {
  phoneVerified?: boolean;
  emailVerified?: boolean;
  available?: boolean;
}

function setup(options: Options = {}) {
  const account = {
    name: "Mona",
    phone: null as string | null,
    accountType: "individual" as "individual" | "organization",
    emailVerified: options.emailVerified ?? false,
    phoneVerified: options.phoneVerified ?? true,
  };
  const progress = {
    userId: USER.id,
    currentStep: "account_type",
    completedSteps: [] as string[],
    data: {} as Record<string, unknown>,
    completedAt: null as Date | null,
  };
  const profile = {
    profession: null as string | null,
    usageIntent: [] as string[],
    country: null,
    city: null,
  };
  const orgs: unknown[] = [];
  const writes: string[] = [];

  const tx = {
    get progress() {
      return progress;
    },
    account: () => Promise.resolve({ ...account }),
    setAccountType: (type: "individual" | "organization") => {
      account.accountType = type;
      writes.push("account_type");
      return Promise.resolve();
    },
    setName: (name: string) => {
      account.name = name;
      writes.push("name");
      return Promise.resolve();
    },
    administeredOrg: () => Promise.resolve(null),
    createOrganization: (fields: Record<string, unknown>) => {
      orgs.push(fields);
      writes.push("organization");
      return Promise.resolve({ id: "00000000-0000-4000-8000-000000000001", ...fields });
    },
    updateOrganization: () => Promise.resolve(),
    saveProfile: (fields: { profession: string; usageIntent: string[] }) => {
      profile.profession = fields.profession;
      writes.push("profession_intent");
      return Promise.resolve();
    },
    saveProgress: (update: { currentStep: string; completedSteps: string[]; data: object }) => {
      progress.currentStep = update.currentStep;
      progress.completedSteps = update.completedSteps;
      progress.data = update.data as Record<string, unknown>;
      progress.completedAt = update.currentStep === "done" ? new Date() : null;
      return Promise.resolve();
    },
  };
  const repo = {
    findAccount: () => Promise.resolve({ ...account }),
    findProfile: () => Promise.resolve(profile),
    findProgress: () => Promise.resolve(progress),
    getOrCreateProgress: () => Promise.resolve(progress),
    findMemberOrg: () => Promise.resolve(null),
    withLockedProgress: <T>(_id: string, work: (t: typeof tx) => Promise<T>) => work(tx),
  };
  const service = new OnboardingService(
    repo as never,
    { availability: () => Promise.resolve({ available: options.available ?? true }) } as never,
    { bustUser: () => Promise.resolve() } as never,
    { recordFor: () => Promise.resolve() } as never,
  );
  return { service, account, progress, profile, orgs, writes };
}

describe("onboardingWelcomeSchema", () => {
  it("wants the organization exactly when the account is one", () => {
    const base = { name: "Mona" };
    expect(onboardingWelcomeSchema.safeParse({ ...base, accountType: "individual" }).success).toBe(
      true,
    );
    expect(
      onboardingWelcomeSchema.safeParse({ ...base, accountType: "organization" }).success,
    ).toBe(false);
    expect(
      onboardingWelcomeSchema.safeParse({ ...base, accountType: "organization", organization: ORG })
        .success,
    ).toBe(true);
    expect(
      onboardingWelcomeSchema.safeParse({ ...base, accountType: "individual", organization: ORG })
        .success,
    ).toBe(false);
  });

  it("takes an optional profession from the known list and nothing unknown", () => {
    const base = { name: "Mona", accountType: "individual" };
    expect(onboardingWelcomeSchema.safeParse({ ...base, profession: "doctor" }).success).toBe(true);
    expect(onboardingWelcomeSchema.safeParse({ ...base, profession: "wizard" }).success).toBe(
      false,
    );
  });
});

describe("OnboardingService.welcome", () => {
  it("finishes an individual in one call, with the free plan and social follow skipped", async () => {
    const h = setup();
    const state = await h.service.welcome(USER, REQUEST, {
      name: "Mona Ali",
      accountType: "individual",
      profession: "pharmacist",
    });
    expect(state.done).toBe(true);
    expect(state.answers.plan).toBe("free");
    expect(state.steps.find((step) => step.step === "social_follow")?.status).toBe("skipped");
    expect(h.account.name).toBe("Mona Ali");
    expect(h.profile.profession).toBe("pharmacist");
    expect(h.progress.completedAt).not.toBeNull();
  });

  it("creates the organization for an organization account", async () => {
    const h = setup();
    const state = await h.service.welcome(USER, REQUEST, {
      name: "Mona",
      accountType: "organization",
      organization: ORG,
    });
    expect(state.done).toBe(true);
    expect(h.orgs).toHaveLength(1);
    expect(h.account.accountType).toBe("organization");
  });

  it("counts an unanswered profession as answered and writes no profile", async () => {
    const h = setup();
    const state = await h.service.welcome(USER, REQUEST, {
      name: "Mona",
      accountType: "individual",
    });
    expect(state.done).toBe(true);
    expect(h.writes).not.toContain("profession_intent");
    expect(h.progress.completedSteps).toContain("profession_intent");
  });

  it("refuses before writing anything when the phone is required and not verified", async () => {
    const h = setup({ phoneVerified: false, emailVerified: false });
    await expect(
      h.service.welcome(USER, REQUEST, { name: "Mona", accountType: "individual" }),
    ).rejects.toMatchObject({ details: { reason: "phone_not_verified" } });
    expect(h.writes).toHaveLength(0);
  });

  it("lets the phone be skipped under the machine's own rule (verification off, email verified)", async () => {
    const h = setup({ phoneVerified: false, emailVerified: true, available: false });
    const state = await h.service.welcome(USER, REQUEST, {
      name: "Mona",
      accountType: "individual",
    });
    expect(state.done).toBe(true);
  });

  it("refuses a finished account", async () => {
    const h = setup();
    await h.service.welcome(USER, REQUEST, { name: "Mona", accountType: "individual" });
    await expect(
      h.service.welcome(USER, REQUEST, { name: "Mona", accountType: "individual" }),
    ).rejects.toMatchObject({ details: { reason: "onboarding_complete" } });
  });
});
