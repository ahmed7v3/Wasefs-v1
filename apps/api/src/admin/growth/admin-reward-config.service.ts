import { Injectable } from "@nestjs/common";
import { dealRuleFor } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { ruleSentence } from "@wasfa/shared/reward-sentence";
import { REWARD_BENEFICIARIES, rewardPointsFor, type RewardEvent } from "@wasfa/shared/rewards";
import {
  moveMemberResultSchema,
  programViewSchema,
  rewardsPreviewSchema,
  ruleListSchema,
  ruleViewSchema,
  tierListSchema,
  tierViewSchema,
  whatIfResultSchema,
  type CreateProgramInput,
  type CreateRuleInput,
  type CreateTierInput,
  type ReasonBody,
  type UpdateProgramInput,
  type UpdateRuleInput,
  type UpdateTierInput,
  type WhatIfInput,
} from "@wasfa/shared/schemas/admin-growth";

import { AdminRewardConfigRepo, type TierShape } from "./admin-reward-config.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { ReferralProgram, ReferralTier, RewardRule } from "@wasfa/db";

const notFound = () => new AppError(ErrorCode.NOT_FOUND);
const conflict = () => new AppError(ErrorCode.CONFLICT);
const invalid = (field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: [field] } });

/** Events whose reward depends on an order's net amount; the others are paid on the event alone. */
const PAYMENT_EVENTS: readonly RewardEvent[] = ["first_payment", "renewal", "credit_pack"];

const iso = (value: Date | null) => value?.toISOString() ?? null;

function ruleView(row: RewardRule) {
  return ruleViewSchema.parse({
    id: row.id,
    programId: row.programId,
    event: row.event,
    beneficiary: row.beneficiary,
    rewardKind: row.rewardKind,
    value: row.value,
    redeemableAs: row.redeemableAs,
    holdDays: row.holdDays,
    maxPerReferrerPerDay: row.maxPerReferrerPerDay,
    maxPerReferrerTotal: row.maxPerReferrerTotal,
    minOrderMinor: row.minOrderMinor,
    validFrom: iso(row.validFrom),
    validTo: iso(row.validTo),
    maxRenewals: row.maxRenewals,
    priority: row.priority,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sentence: ruleSentence(row),
  });
}

const ruleAudit = (row: RewardRule) => ({
  programId: row.programId,
  event: row.event,
  beneficiary: row.beneficiary,
  rewardKind: row.rewardKind,
  value: row.value,
  redeemableAs: row.redeemableAs,
  holdDays: row.holdDays,
  maxPerReferrerPerDay: row.maxPerReferrerPerDay,
  maxPerReferrerTotal: row.maxPerReferrerTotal,
  minOrderMinor: row.minOrderMinor,
  validFrom: iso(row.validFrom),
  validTo: iso(row.validTo),
  maxRenewals: row.maxRenewals,
  priority: row.priority,
  active: row.active,
});

const tierAudit = (row: ReferralTier) => ({
  programId: row.programId,
  key: row.key,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  minPaidReferrals: row.minPaidReferrals,
  bonusBps: row.bonusBps,
  active: row.active,
});

const programAudit = (row: ReferralProgram) => ({
  key: row.key,
  kind: row.kind,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  active: row.active,
});

/** The tier ladder rule: a higher threshold never pays a lower bonus (REFERRALS §3.4). */
function ladderIsSound(tiers: readonly TierShape[]): boolean {
  const active = tiers
    .filter((tier) => tier.active)
    .sort((a, b) => a.minPaidReferrals - b.minPaidReferrals);
  return active.every(
    (tier, index) => index === 0 || tier.bonusBps >= (active[index - 1]?.bonusBps ?? 0),
  );
}

@Injectable()
export class AdminRewardConfigService {
  constructor(private readonly repo: AdminRewardConfigRepo) {}

  // --- Programs ---------------------------------------------------------------------------------

  async programs() {
    const rows = await this.repo.programs();
    const counts = await this.repo.programCounts(rows.map((row) => row.id));
    return {
      items: rows.map((row) =>
        programViewSchema.parse({
          id: row.id,
          key: row.key,
          kind: row.kind,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          active: row.active,
          createdAt: row.createdAt.toISOString(),
          counts: counts.get(row.id),
        }),
      ),
    };
  }

  private async programView(row: ReferralProgram) {
    const counts = await this.repo.programCounts([row.id]);
    return programViewSchema.parse({
      id: row.id,
      key: row.key,
      kind: row.kind,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      counts: counts.get(row.id),
    });
  }

  async createProgram(input: CreateProgramInput, audit: AuditScope) {
    const row = await this.repo.createProgram(input);
    if (!row) throw conflict();
    audit.targetId = row.id;
    audit.after = programAudit(row);
    return this.programView(row);
  }

  async updateProgram(id: string, input: UpdateProgramInput, audit: AuditScope) {
    const { reason, ...values } = input;
    const result = await this.repo.updateProgram(id, values);
    if (!result) throw notFound();
    audit.targetId = id;
    audit.before = programAudit(result.before);
    audit.after = { ...programAudit(result.after), reason };
    return this.programView(result.after);
  }

  async moveMember(programId: string, userId: string, reason: string, audit: AuditScope) {
    const result = await this.repo.moveMember(userId, programId);
    if (result.kind === "program_missing") throw notFound();
    if (result.kind === "user_missing") throw invalid("userId");
    audit.targetId = programId;
    audit.before = { userId, programIds: result.before };
    audit.after = {
      userId,
      programId,
      codesMoved: result.codesMoved,
      referralsMoved: result.referralsMoved,
      reason,
    };
    return moveMemberResultSchema.parse({
      userId,
      programId,
      codesMoved: result.codesMoved,
      referralsMoved: result.referralsMoved,
    });
  }

  // --- Rules ------------------------------------------------------------------------------------

  async rules(programId: string) {
    if (!(await this.repo.findProgram(programId))) throw notFound();
    return ruleListSchema.parse({ items: (await this.repo.rulesOf(programId)).map(ruleView) });
  }

  async createRule(programId: string, input: CreateRuleInput, audit: AuditScope) {
    if (!(await this.repo.findProgram(programId))) throw notFound();
    const { reason, ...values } = input;
    const row = await this.repo.createRule(programId, values);
    audit.targetId = row.id;
    audit.after = { ...ruleAudit(row), reason };
    return ruleView(row);
  }

  async updateRule(id: string, input: UpdateRuleInput, audit: AuditScope) {
    const { reason, ...values } = input;
    const result = await this.repo.updateRule(id, values);
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "invalid") throw invalid("value");
    audit.targetId = id;
    audit.before = ruleAudit(result.before);
    audit.after = { ...ruleAudit(result.after), reason };
    return ruleView(result.after);
  }

  deactivateRule(id: string, body: ReasonBody, audit: AuditScope) {
    return this.updateRule(id, { active: false, reason: body.reason }, audit);
  }

  /**
   * What each side earns for one sample event, from the rule the engine would pick and the engine's
   * own amount function (`rewardPointsFor`), so the preview is what is paid. With `dealId` the
   * deal's reward terms override the program's rules, as they do for its members at pay time.
   */
  async whatIf(input: WhatIfInput) {
    if (!(await this.repo.findProgram(input.programId))) throw notFound();
    const [settings, rules, dealRewards] = await Promise.all([
      this.repo.rewardsSettings(),
      this.repo.effectiveRulesOf(input.programId, new Date()),
      input.dealId ? this.repo.dealRewards(input.dealId) : Promise.resolve(null),
    ]);
    if (input.dealId && dealRewards === null) throw notFound();
    // The engine passes a net amount only with a payment; sign-up and join events pay on the event.
    const hasNet = PAYMENT_EVENTS.includes(input.event);
    const net = hasNet ? input.netMinor : 0;
    const beneficiaries = REWARD_BENEFICIARIES.map((beneficiary) => {
      // A deal's rule wins over the program's, exactly as `dealRewardOverrides` decides at pay time.
      const fromDeal =
        input.dealId && dealRewards
          ? dealRuleFor(input.dealId, dealRewards, input.event, beneficiary, settings.holdDaysDefault)
          : null;
      const rule =
        fromDeal ??
        rules.find((row) => row.event === input.event && row.beneficiary === beneficiary);
      if (!rule) {
        return {
          beneficiary,
          ruleId: null,
          source: null,
          sentence: null,
          points: 0,
          credits: 0,
          valueMinor: 0,
          holdDays: 0,
          bucket: null,
          deniedReason: null,
        };
      }
      const belowMinimum = hasNet && rule.minOrderMinor !== null && net < rule.minOrderMinor;
      const tierBonus = beneficiary === "referrer" ? input.tierBonusBps : 0;
      const paid = belowMinimum
        ? { points: 0, credits: 0 }
        : rewardPointsFor(rule, net, settings, tierBonus);
      return {
        beneficiary,
        ruleId: rule.id,
        source: rule.source,
        sentence: ruleSentence({ ...rule, event: input.event, beneficiary }),
        points: paid.points,
        credits: paid.credits,
        valueMinor: paid.points * settings.pointValueMinor,
        holdDays: rule.holdDays,
        bucket:
          paid.points > 0 ? (rule.redeemableAs === "credits_only" ? "credit_only" : "cash") : null,
        deniedReason: belowMinimum ? "min_order" : null,
      };
    });
    return whatIfResultSchema.parse({
      programId: input.programId,
      event: input.event,
      netMinor: net,
      currency: settings.currency,
      pointValueMinor: settings.pointValueMinor,
      beneficiaries,
    });
  }

  // --- Tiers ------------------------------------------------------------------------------------

  private async tierViews(programId: string) {
    const tiers = await this.repo.tiersOf(programId);
    const counts = await this.repo.memberCounts(programId, tiers, new Date());
    return tiers.map((row) =>
      tierViewSchema.parse({
        id: row.id,
        programId: row.programId,
        key: row.key,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        minPaidReferrals: row.minPaidReferrals,
        bonusBps: row.bonusBps,
        active: row.active,
        memberCount: counts.get(row.id) ?? 0,
      }),
    );
  }

  async tiers(programId: string) {
    if (!(await this.repo.findProgram(programId))) throw notFound();
    return tierListSchema.parse({ items: await this.tierViews(programId) });
  }

  private async tierView(row: ReferralTier) {
    const view = (await this.tierViews(row.programId)).find((tier) => tier.id === row.id);
    if (!view) throw notFound();
    return view;
  }

  async createTier(programId: string, input: CreateTierInput, audit: AuditScope) {
    if (!(await this.repo.findProgram(programId))) throw notFound();
    const { reason, ...values } = input;
    const result = await this.repo.createTier(programId, values, ladderIsSound);
    if (result.kind === "conflict") throw conflict();
    if (result.kind === "invalid") throw invalid("bonusBps");
    if (result.kind !== "ok" || !result.after) throw notFound();
    audit.targetId = result.after.id;
    audit.after = { ...tierAudit(result.after), reason };
    return this.tierView(result.after);
  }

  async updateTier(id: string, input: UpdateTierInput, audit: AuditScope) {
    const { reason, ...values } = input;
    const result = await this.repo.updateTier(id, values, ladderIsSound);
    if (result.kind === "conflict") throw conflict();
    if (result.kind === "invalid") throw invalid("bonusBps");
    if (result.kind !== "ok" || !result.after || !result.before) throw notFound();
    audit.targetId = id;
    audit.before = tierAudit(result.before);
    audit.after = { ...tierAudit(result.after), reason };
    return this.tierView(result.after);
  }

  async deleteTier(id: string, reason: string, audit: AuditScope) {
    const result = await this.repo.deleteTier(id);
    if (result.kind !== "ok" || !result.before) throw notFound();
    audit.targetId = id;
    audit.before = tierAudit(result.before);
    audit.after = { deleted: true, reason };
  }

  // --- Settings preview -------------------------------------------------------------------------

  async settingsPreview() {
    const settings = await this.repo.rewardsSettings();
    const field = (
      key:
        | "minWithdrawalPoints"
        | "maxWithdrawalPointsPerMonth"
        | "fourEyesThresholdPoints"
        | "weeklyBudgetPoints"
        | "pointsPerCredit",
    ) => ({
      key,
      points: settings[key],
      valueMinor: settings[key] * settings.pointValueMinor,
    });
    return rewardsPreviewSchema.parse({
      pointValueMinor: settings.pointValueMinor,
      currency: settings.currency,
      fields: [
        field("minWithdrawalPoints"),
        field("maxWithdrawalPointsPerMonth"),
        field("fourEyesThresholdPoints"),
        field("weeklyBudgetPoints"),
        field("pointsPerCredit"),
      ],
    });
  }
}
