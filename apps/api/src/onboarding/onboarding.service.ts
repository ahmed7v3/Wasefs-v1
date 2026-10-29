import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  USAGE_INTENTS,
  type OnboardingStep,
  type Profession,
  type UsageIntent,
} from "@wasfa/shared/identity";

import { AuditService } from "../audit/audit.service.js";
import { PhoneService } from "../phone/phone.service.js";
import { RbacService } from "../rbac/rbac.service.js";

import {
  canSubmit,
  evaluate,
  knownSteps,
  phoneSkippable,
  phoneStepPassed,
  type MachineState,
} from "./onboarding.machine.js";
import { OnboardingRepo, type OrgFields } from "./onboarding.repo.js";
import {
  parseSubmission,
  readProgressData,
  type ProgressData,
  type StepSubmission,
} from "./onboarding.schemas.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type {
  OnboardingInputStep,
  OnboardingState,
  OnboardingWelcomeInput,
} from "@wasfa/shared/schemas/onboarding";
import type { FastifyRequest } from "fastify";

/** Organization fields kept in the audit trail. */
const ORG_AUDIT_FIELDS = ["name", "type", "country", "city"] as const;

interface OrgChange {
  action: "org.create" | "org.update";
  orgId: string;
  before?: OrgFields;
  after: OrgFields;
}

/** A step answer, or the one-screen flow sending a lone (possibly empty) profession. */
type AppliedSubmission =
  StepSubmission | { step: "profession_intent"; input: { profession: Profession | null } };

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });

const isUsageIntent = (value: string): value is UsageIntent =>
  (USAGE_INTENTS as readonly string[]).includes(value);

const orgFields = (org: OrgFields): OrgFields => ({
  name: org.name,
  type: org.type,
  country: org.country,
  city: org.city,
});

/** The onboarding wizard (Task 1.7): the rules live in `onboarding.machine.ts`, the writes here. */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly repo: OnboardingRepo,
    private readonly phone: PhoneService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /** Where the wizard stands, for `/me`. Does not create the progress row. */
  async summary(user: {
    id: string;
  }): Promise<{ currentStep: OnboardingStep; done: boolean; followed?: true }> {
    const [account, progress] = await Promise.all([
      this.repo.findAccount(user.id),
      this.repo.findProgress(user.id),
    ]);
    if (!account) throw new AppError(ErrorCode.AUTH_REQUIRED);
    // Finished stays finished: no need to look at the environment.
    const followed = readProgressData(progress?.data).followed === true;
    const social = followed ? ({ followed: true } as const) : {};
    if (progress?.completedAt) return { currentStep: "done", done: true, ...social };

    const { available } = await this.phone.availability();
    const view = evaluate({
      accountType: account.accountType,
      phoneVerified: account.phoneVerified,
      emailVerified: account.emailVerified,
      phoneVerificationAvailable: available,
      completedSteps: knownSteps(progress?.completedSteps ?? []),
      followed: readProgressData(progress?.data).followed,
    });
    return { currentStep: view.currentStep, done: view.currentStep === "done", ...social };
  }

  /** The full wizard state; creates the progress row on the first visit. */
  async state(user: { id: string }): Promise<OnboardingState> {
    const progress = await this.repo.getOrCreateProgress(user.id);
    const [account, profile, { available }] = await Promise.all([
      this.repo.findAccount(user.id),
      this.repo.findProfile(user.id),
      this.phone.availability(),
    ]);
    if (!account) throw new AppError(ErrorCode.AUTH_REQUIRED);

    const data = readProgressData(progress.data);
    const machine: MachineState = {
      accountType: account.accountType,
      phoneVerified: account.phoneVerified,
      emailVerified: account.emailVerified,
      phoneVerificationAvailable: available,
      completedSteps: knownSteps(progress.completedSteps),
      followed: data.followed,
      finished: progress.completedAt !== null,
    };
    const view = evaluate(machine);
    const organization = data.orgId ? await this.repo.findMemberOrg(user.id, data.orgId) : null;

    return {
      currentStep: view.currentStep,
      done: view.currentStep === "done",
      completedAt: progress.completedAt?.toISOString() ?? null,
      steps: view.steps,
      answers: {
        accountType: account.accountType,
        name: account.name,
        phone: account.phone,
        phoneVerified: account.phoneVerified,
        phoneSkippable: phoneSkippable({
          phoneVerificationAvailable: available,
          emailVerified: account.emailVerified,
        }),
        organization,
        profession: profile?.profession ?? null,
        usageIntent: (profile?.usageIntent ?? []).filter(isUsageIntent),
        country: profile?.country ?? null,
        city: profile?.city ?? null,
        plan: data.plan ?? null,
      },
    };
  }

  /** Answers one step (or re-answers an earlier one). Everything is written in one transaction. */
  async submit(
    user: AuthenticatedUser,
    request: FastifyRequest,
    step: OnboardingInputStep,
    body: unknown,
  ): Promise<OnboardingState> {
    // Bad input is a 400 before anything about the account's state is revealed or locked.
    return this.apply(user, request, parseSubmission(step, body));
  }

  /**
   * "I followed the page" from the dashboard card, which shows after the first analysis, long after
   * the wizard finished: the answer is recorded without reopening any step.
   */
  async markFollowed(user: { id: string }): Promise<void> {
    await this.repo.withLockedProgress(user.id, (tx) => tx.mergeData({ followed: true }));
  }

  /**
   * The whole wizard in one call (`PUT /onboarding/welcome`). It is the same steps through the same
   * rules, one after the other: the machine still decides the order, so a phone that must be
   * verified and is not refuses the call before anything is written, and every step stays
   * re-answerable. Social follow is skipped (it becomes a dashboard card) and the plan is the free one.
   */
  async welcome(
    user: AuthenticatedUser,
    request: FastifyRequest,
    input: OnboardingWelcomeInput,
  ): Promise<OnboardingState> {
    const [account, { available }] = await Promise.all([
      this.repo.findAccount(user.id),
      this.phone.availability(),
    ]);
    if (!account) throw new AppError(ErrorCode.AUTH_REQUIRED);
    if (
      !phoneStepPassed({
        accountType: account.accountType,
        phoneVerified: account.phoneVerified,
        emailVerified: account.emailVerified,
        phoneVerificationAvailable: available,
        completedSteps: [],
      })
    ) {
      throw conflict("phone_not_verified");
    }

    const steps: AppliedSubmission[] = [
      { step: "account_type", input: { accountType: input.accountType } },
      { step: "name", input: { name: input.name } },
      ...(input.organization === undefined
        ? []
        : [{ step: "organization" as const, input: input.organization }]),
      { step: "profession_intent", input: { profession: input.profession ?? null } },
      { step: "social_follow", input: { followed: false } },
      { step: "plan_picker", input: { plan: "free" } },
    ];
    let state: OnboardingState | undefined;
    for (const submission of steps) state = await this.apply(user, request, submission);
    if (!state) throw new AppError(ErrorCode.INTERNAL);
    return state;
  }

  private async apply(
    user: AuthenticatedUser,
    request: FastifyRequest,
    submission: AppliedSubmission,
  ): Promise<OnboardingState> {
    const step = submission.step;
    const { available } = await this.phone.availability();
    // Only the one-screen flow sends a lone profession; read before the lock like the other lookups.
    const existingProfile =
      submission.step === "profession_intent" && !("usageIntent" in submission.input)
        ? await this.repo.findProfile(user.id)
        : null;

    const orgChange = await this.repo.withLockedProgress(user.id, async (tx) => {
      const account = await tx.account();
      const data = readProgressData(tx.progress.data);
      const before: MachineState = {
        accountType: account.accountType,
        phoneVerified: account.phoneVerified,
        emailVerified: account.emailVerified,
        phoneVerificationAvailable: available,
        completedSteps: knownSteps(tx.progress.completedSteps),
        followed: data.followed,
        finished: tx.progress.completedAt !== null,
      };
      const allowed = canSubmit(before, step);
      if (!allowed.ok) throw conflict(allowed.reason);

      let accountType = account.accountType;
      const nextData: ProgressData = { ...data };
      let change: OrgChange | null = null;

      switch (submission.step) {
        case "account_type": {
          // An organization already exists for this account; it cannot silently become personal.
          if (
            before.completedSteps.includes("organization") &&
            submission.input.accountType !== account.accountType
          ) {
            throw conflict("account_type_locked");
          }
          accountType = submission.input.accountType;
          await tx.setAccountType(accountType);
          break;
        }
        case "phone": {
          // Verified through the phone flow (Task 1.5), never by this call alone.
          if (!phoneStepPassed(before)) throw conflict("phone_not_verified");
          break;
        }
        case "name": {
          await tx.setName(submission.input.name);
          break;
        }
        case "organization": {
          const fields: OrgFields = {
            name: submission.input.name,
            type: submission.input.type,
            country: submission.input.country,
            city: submission.input.city ?? null,
          };
          const existing = data.orgId ? await tx.administeredOrg(data.orgId) : null;
          if (existing) {
            await tx.updateOrganization(existing.id, fields);
            change = {
              action: "org.update",
              orgId: existing.id,
              before: orgFields(existing),
              after: fields,
            };
          } else {
            const created = await tx.createOrganization(fields);
            nextData.orgId = created.id;
            change = { action: "org.create", orgId: created.id, after: fields };
          }
          break;
        }
        case "profession_intent": {
          const { input } = submission;
          if ("usageIntent" in input) {
            await tx.saveProfile({
              profession: input.profession,
              usageIntent: input.usageIntent,
              country: input.country,
              city: input.city ?? null,
            });
          } else if (input.profession !== null) {
            // One-screen flow: just the profession; what the profile already holds stays.
            await tx.saveProfile({
              profession: input.profession,
              usageIntent: existingProfile?.usageIntent ?? [],
              country: existingProfile?.country ?? null,
              city: existingProfile?.city ?? null,
            });
          }
          // No profession chosen: the step counts as answered with nothing written.
          break;
        }
        case "plan_picker": {
          // A recorded intent only: checkout validates a paid plan against the catalog.
          const { input } = submission;
          nextData.plan = input.plan;
          if (input.plan === "paid") {
            nextData.planKey = input.planKey;
            nextData.months = input.months;
          } else {
            delete nextData.planKey;
            delete nextData.months;
          }
          break;
        }
        case "social_follow": {
          nextData.followed = submission.input.followed;
          break;
        }
      }

      // `phone` is derived from the account, never stored as completed.
      const completedSteps =
        step === "phone" || before.completedSteps.includes(step)
          ? before.completedSteps
          : [...before.completedSteps, step];
      const view = evaluate({
        ...before,
        accountType,
        completedSteps,
        followed: nextData.followed,
        finished: false,
      });
      await tx.saveProgress({
        currentStep: view.currentStep,
        completedSteps: [...completedSteps],
        data: nextData,
      });
      return change;
    });

    if (orgChange) {
      // Membership changed: the cached `orgIds` of the caller are stale.
      await this.rbac.bustUser(user.id);
      await this.audit.recordFor(
        request,
        {
          actorId: user.id,
          action: orgChange.action,
          targetType: "org",
          targetId: orgChange.orgId,
          before: orgChange.before,
          after: orgChange.after,
        },
        { fields: ORG_AUDIT_FIELDS },
      );
    }
    return this.state(user);
  }
}
