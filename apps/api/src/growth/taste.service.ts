import { Inject, Injectable } from "@nestjs/common";
import { expireTasteRemainder, type RxAnalysis } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { rxResultSchema, type RxResultItem } from "@wasfa/shared/schemas/rx";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { REDIS } from "../common/redis.js";
import { PlansService } from "../plans/plans.service.js";
import { RxService } from "../rx/rx.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { GrowthRepo } from "./growth.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { StartTasteInput, TasteCompareItem } from "@wasfa/shared/schemas/growth";

const WEEK_MS = 7 * 86_400_000;
const BADGE_RANK = { low: 0, medium: 1, high: 2 } as const;

/** Why a taste is not possible right now; the web shows `growth.taste.refusal.<reason>`. */
export type TasteRefusal = "not_eligible" | "weekly_limit" | "budget";

export interface TasteEligibility {
  eligible: boolean;
  reason: TasteRefusal | null;
  credits: number;
  routePlanId: string | null;
}

const refuse = (reason: TasteRefusal): never => {
  throw new AppError(ErrorCode.CONFLICT, { details: { reason } });
};

/**
 * The taste of Deep mode (GROWTH §5): a verified free account re-reads ONE finished prescription
 * with Deep mode, once a week, inside a global weekly budget. The grant puts exactly the analysis'
 * price in the wallet through the ledger, and the analysis then goes through the normal reserve ->
 * settle path (no AI call without a reservation); the only exception is the plan's mode list, which
 * the taste is allowed to pass for this one analysis. Credits it does not use are taken back.
 */
@Injectable()
export class TasteService {
  constructor(
    private readonly repo: GrowthRepo,
    private readonly rx: RxService,
    private readonly plans: PlansService,
    private readonly settings: SettingsService,
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Taste");
  }

  /** Every rule of §5 except the source analysis' own checks, which the callers make first. */
  async eligibility(
    user: AuthenticatedUser,
    source: RxAnalysis,
    now = new Date(),
  ): Promise<TasteEligibility> {
    const no = (reason: TasteRefusal): TasteEligibility => ({
      eligible: false,
      reason,
      credits: 0,
      routePlanId: null,
    });
    const [growth, rx] = await Promise.all([
      this.settings.get("growth"),
      this.settings.get("rx"),
    ]);
    if (!growth.taste.enabled || growth.killSwitch) return no("budget");
    // Only verified accounts: the verified-phone rule is what limits one person to one taste a week.
    if (!user.phoneVerified) return no("not_eligible");
    const plan = await this.plans.effectivePlan({ type: "user", id: user.id }, now);
    if (!plan.isDefault || (await this.repo.liveSubscription(user.id)) !== undefined) {
      return no("not_eligible");
    }
    const deepPlan = await this.repo.deepPlan();
    if (!deepPlan) return no("not_eligible");

    const pages = await this.repo.pageFileIds(source.id);
    const credits = pages.length * rx.creditsPerPage;
    const usage = await this.repo.tasteUsage(user.id, new Date(now.getTime() - WEEK_MS));
    if (usage.userGrants >= growth.taste.perUserPerWeek) return no("weekly_limit");
    if (
      usage.globalGrants >= growth.taste.weeklyCap ||
      usage.globalCredits + credits > growth.taste.weeklyBudgetCredits
    ) {
      return no("budget");
    }
    return { eligible: true, reason: null, credits, routePlanId: deepPlan.id };
  }

  async start(user: AuthenticatedUser, input: StartTasteInput, now = new Date()) {
    const source = await this.repo.analysisOf(user.id, input.rxId);
    if (!source) throw new AppError(ErrorCode.NOT_FOUND);

    // A repeated request (same request id, or a taste already made from this result) answers the same.
    const earlier = await this.repo.tasteFromSource(user.id, source.id);
    if (earlier) {
      if (earlier.analysisId === null) refuse("not_eligible");
      return { grantId: earlier.id, analysisId: earlier.analysisId as string };
    }
    if (source.status !== "done" || source.mode === "deep") refuse("not_eligible");
    if (await this.repo.isTasteAnalysis(source.id)) refuse("not_eligible");

    const eligibility = await this.eligibility(user, source, now);
    if (!eligibility.eligible || eligibility.routePlanId === null) {
      refuse(eligibility.reason ?? "not_eligible");
    }
    const routePlanId = eligibility.routePlanId as string;

    const { grant } = await this.repo.grantTaste({
      userId: user.id,
      requestId: input.requestId,
      sourceAnalysisId: source.id,
      credits: eligibility.credits,
      now,
    });
    if (grant.analysisId !== null) return { grantId: grant.id, analysisId: grant.analysisId };

    let analysisId: string;
    try {
      const fileIds = await this.repo.pageFileIds(source.id);
      const created = await this.rx.create(user, { fileIds, mode: "deep" }, { routePlanId });
      analysisId = created.id;
    } catch (error) {
      // The Deep analysis did not start: the granted credits must not stay spendable.
      await expireTasteRemainder(this.handle.db, grant.id, { force: true }).catch(() => {
        this.logger.error({ grantId: grant.id }, "taste credits could not be taken back");
      });
      throw error;
    }
    await this.repo.attachTaste(grant.id, analysisId, now);
    await this.repo.recordEvent({
      name: "taste_started",
      sessionId: `srv:${user.id}`,
      userId: user.id,
      props: { kind: "deep_mode" },
    });
    return { grantId: grant.id, analysisId };
  }

  /** Both results side by side, with each item's change: the evidence of what Deep mode did. */
  async compare(user: AuthenticatedUser, grantId: string) {
    const grant = await this.repo.tasteGrantOf(user.id, grantId);
    if (!grant || grant.sourceAnalysisId === null || grant.analysisId === null) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    const [beforeRow, afterRow] = await Promise.all([
      this.repo.analysisOf(user.id, grant.sourceAnalysisId),
      this.repo.analysisOf(user.id, grant.analysisId),
    ]);
    if (!beforeRow || !afterRow) throw new AppError(ErrorCode.NOT_FOUND);
    const [before, after] = await Promise.all([this.rx.view(beforeRow), this.rx.view(afterRow)]);
    const items = afterRow.status === "done" ? diffItems(beforeRow, afterRow) : [];
    if (
      afterRow.status === "done" &&
      (await this.redis.set(`growth:taste_completed:${grant.id}`, "1", "EX", 2_592_000, "NX")) ===
        "OK"
    ) {
      // Recorded once per grant: the completion is a funnel step, not a page view.
      await this.repo.recordEvent({
        name: "taste_completed",
        sessionId: `srv:${user.id}`,
        userId: user.id,
        props: { kind: "deep_mode", grant: grant.id.slice(0, 8) },
      });
    }
    return { grantId: grant.id, before, after, items };
  }
}

const side = (item: RxResultItem | undefined) =>
  item ? { name: item.name, badge: item.badge, confidence: item.confidence } : null;

/** Items paired by position; "improved" = a better badge, or a name read where there was none. */
export function diffItems(before: RxAnalysis, after: RxAnalysis): TasteCompareItem[] {
  const a = rxResultSchema.safeParse(before.result);
  const b = rxResultSchema.safeParse(after.result);
  const left = a.success ? a.data.items : [];
  const right = b.success ? b.data.items : [];
  const count = Math.max(left.length, right.length);
  const items: TasteCompareItem[] = [];
  for (let index = 0; index < count; index++) {
    const was = left[index];
    const now = right[index];
    const improved =
      was !== undefined &&
      now !== undefined &&
      (BADGE_RANK[now.badge] > BADGE_RANK[was.badge] || (was.name === null && now.name !== null));
    items.push({ index, before: side(was), after: side(now), improved });
  }
  return items;
}
