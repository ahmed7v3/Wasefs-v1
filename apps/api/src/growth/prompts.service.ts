import { Inject, Injectable } from "@nestjs/common";
import {
  CREDITS_LOW_USED_PERCENT,
  EXPIRING_CREDITS_DAYS,
  ORG_USAGE_MIN_ANALYSES,
  ORG_USAGE_MIN_MEMBERS,
  PLAN_EXPIRING_DAYS,
  TASTE_PROMPT_ANALYSIS_NUMBERS,
  promptCooldownDays,
  promptExperimentKey,
  promptSessionKey,
  variantFor,
  type GrowthPromptKind,
} from "@wasfa/shared/growth";
import { rxResultSchema } from "@wasfa/shared/schemas/rx";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { CreditsService } from "../credits/credits.service.js";
import { PayerService } from "../orgs/wallet/payer.service.js";
import { PlansService } from "../plans/plans.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { GrowthRepo } from "./growth.repo.js";
import { TasteService } from "./taste.service.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type {
  GrowthPrompt,
  GrowthPromptQuery,
  GrowthPromptResponse,
} from "@wasfa/shared/schemas/growth";

const DAY_MS = 86_400_000;
/** The copy outside an experiment, and the control arm inside one. */
const CONTROL_VARIANT = "a";

/** Prompts that sell something: shown to free accounts only (GROWTH §4). */
const UPSELL_KINDS: ReadonlySet<GrowthPromptKind> = new Set([
  "analysis_taste",
  "credits_low",
  "credits_out",
  "locked_feature",
]);

type Candidate = Omit<GrowthPrompt, "variant" | "messageKey"> & { messageBase: string };

/**
 * `GrowthService.nextPrompt` of GROWTH-STRATEGY §4: at most one calm, closable card per request,
 * only after a real moment of value. It is side-effect free: the one-per-session reservation is
 * taken when the web reports `prompt_shown`, so a prefetch or a reload never burns the session's
 * prompt. The guardrails of §2 are enforced here, not in the web: the session cap, the per-kind
 * cooldown that doubles with each dismissal (capped), the kill switch, nothing for a result that is
 * not finished (never during an upload, an analysis or an error), and upsells for free accounts only.
 */
@Injectable()
export class PromptsService {
  constructor(
    private readonly repo: GrowthRepo,
    private readonly credits: CreditsService,
    private readonly plans: PlansService,
    private readonly payer: PayerService,
    private readonly settings: SettingsService,
    private readonly taste: TasteService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async next(
    user: AuthenticatedUser,
    query: GrowthPromptQuery,
    now = new Date(),
  ): Promise<GrowthPromptResponse> {
    const growth = await this.settings.get("growth");
    if (!growth.prompts.enabled || growth.killSwitch || growth.prompts.maxPerSession === 0) {
      return { prompt: null };
    }
    const shownThisSession = Number(await this.redis.get(promptSessionKey(query.sessionId)));
    if (shownThisSession >= growth.prompts.maxPerSession) return { prompt: null };

    const candidates = await this.candidates(user, query, now);
    for (const candidate of candidates) {
      if (await this.coolingDown(user.id, candidate.kind, growth.prompts, now)) continue;
      return { prompt: await this.withCopy(user.id, candidate) };
    }
    return { prompt: null };
  }

  /** The moments that are true right now for this context, most relevant first. */
  private async candidates(
    user: AuthenticatedUser,
    query: GrowthPromptQuery,
    now: Date,
  ): Promise<Candidate[]> {
    if (query.context === "pricing") return [];

    // An organization context is the organization's plan and wallet; the person is a member there.
    if (query.orgId !== undefined) {
      if (query.context !== "dashboard") return [];
      return this.orgCandidates(user, query.orgId, now);
    }

    const free = await this.isFreeAccount(user.id, now);
    const out: Candidate[] = [];
    if (query.context === "locked") {
      if (free && query.feature !== undefined) {
        out.push({
          kind: "locked_feature",
          messageBase: `growth.prompt.locked_feature.${query.feature}`,
          params: {},
          cta: { kind: "pricing", href: "/pricing" },
        });
      }
      return out;
    }

    if (query.context === "result") {
      if (query.rxId === undefined || !free) return out;
      const taste = await this.tasteMoment(user, query.rxId, now);
      if (taste) out.push(taste);
      return out;
    }

    // dashboard and credits
    const expiring = await this.planExpiring(user.id, now);
    if (expiring && query.context === "dashboard") out.push(expiring);
    const view = await this.credits.forUser(user.id, now);
    const balance = view.wallet.balance;
    const monthly = view.monthlyCredits;
    const nextGrant = new Date(view.nextGrantAt);
    const daysToGrant = Math.ceil((nextGrant.getTime() - now.getTime()) / DAY_MS);
    if (free && monthly > 0 && balance > 0 && daysToGrant <= EXPIRING_CREDITS_DAYS) {
      // True and useful, no upsell: "you have credits that expire" with an analyse button.
      out.push({
        kind: "expiring_free_credits",
        messageBase: "growth.prompt.expiring_free_credits",
        params: { credits: balance, days: Math.max(1, daysToGrant) },
        cta: { kind: "analyze", href: "/analyze" },
      });
    }
    if (free && balance === 0) {
      // The free renewal date always comes first (GROWTH §4).
      out.push({
        kind: "credits_out",
        messageBase: "growth.prompt.credits_out",
        params: { date: view.nextGrantAt.slice(0, 10) },
        cta: { kind: "pack", href: "/billing#packs" },
      });
    } else if (free && monthly > 0) {
      const used = Math.max(0, monthly - balance);
      if (used * 100 >= monthly * CREDITS_LOW_USED_PERCENT) {
        out.push({
          kind: "credits_low",
          messageBase: "growth.prompt.credits_low",
          params: { used, total: monthly, left: Math.max(0, balance) },
          cta: { kind: "pricing", href: "/pricing" },
        });
      }
    }
    return out;
  }

  private async orgCandidates(
    user: AuthenticatedUser,
    orgId: string,
    now: Date,
  ): Promise<Candidate[]> {
    // `resolve` refuses a non-member as NOT_FOUND; a prompt is never worth an error page.
    const context = await this.payer.resolve(user.id, orgId).catch(() => null);
    if (context === null) return [];
    const plan = await this.plans.effectivePlan({ type: "org", id: orgId }, now);
    if (!plan.isDefault) return [];
    const usage = await this.repo.orgUsage(orgId, now);
    if (usage.members < ORG_USAGE_MIN_MEMBERS && usage.analyses < ORG_USAGE_MIN_ANALYSES) {
      return [];
    }
    return [
      {
        kind: "org_usage",
        messageBase: "growth.prompt.org_usage",
        params: { analyses: usage.analyses, members: usage.members },
        cta: { kind: "pricing", href: `/pricing?org=${orgId}` },
      },
    ];
  }

  /** The first, third and tenth finished analysis with an uncertain item, when a taste is possible. */
  private async tasteMoment(
    user: AuthenticatedUser,
    rxId: string,
    now: Date,
  ): Promise<Candidate | null> {
    const row = await this.repo.analysisOf(user.id, rxId);
    // Only a finished, successful result: never while it runs, never on an error or a refund.
    if (!row || row.status !== "done" || row.mode === "deep") return null;
    if (await this.repo.isTasteAnalysis(row.id)) return null;
    const number = await this.repo.doneAnalysisNumber(user.id, row);
    if (!(TASTE_PROMPT_ANALYSIS_NUMBERS as readonly number[]).includes(number)) return null;
    const parsed = rxResultSchema.safeParse(row.result);
    if (!parsed.success) return null;
    const uncertain = parsed.data.items.filter((item) => item.badge !== "high").length;
    if (uncertain === 0) return null;
    const eligibility = await this.taste.eligibility(user, row, now);
    if (!eligibility.eligible) return null;
    return {
      kind: "analysis_taste",
      messageBase: "growth.prompt.analysis_taste",
      params: { count: uncertain },
      cta: { kind: "taste" },
    };
  }

  private async planExpiring(userId: string, now: Date): Promise<Candidate | null> {
    const live = await this.repo.liveSubscription(userId);
    if (!live || live.status === "grace" || live.source !== "paid") return null;
    const days = Math.ceil((live.currentPeriodEnd.getTime() - now.getTime()) / DAY_MS);
    // Inside the 7/3/1-day marks: the prompt carries the true number of days left.
    if (days < 1 || days > Math.max(...PLAN_EXPIRING_DAYS)) return null;
    return {
      kind: "plan_expiring",
      messageBase: "growth.prompt.plan_expiring",
      params: { days },
      cta: { kind: "renew", href: `/billing/renew?sub=${live.id}` },
    };
  }

  /** Free = the default plan and no live paid period (a trial or a gift is not "free" either). */
  private async isFreeAccount(userId: string, now: Date): Promise<boolean> {
    const plan = await this.plans.effectivePlan({ type: "user", id: userId }, now);
    if (!plan.isDefault) return false;
    const live = await this.repo.liveSubscription(userId);
    return live === undefined;
  }

  private async coolingDown(
    userId: string,
    kind: GrowthPromptKind,
    prompts: { cooldownDays: number; maxCooldownDays: number },
    now: Date,
  ): Promise<boolean> {
    // Upsell kinds share one history per kind; the plain reminders (expiry) too.
    const history = await this.repo.promptHistory(userId, kind, now);
    if (history.lastDismissedAt !== null) {
      const quietDays = promptCooldownDays(
        prompts.cooldownDays,
        prompts.maxCooldownDays,
        history.dismissals,
      );
      if (now.getTime() - history.lastDismissedAt.getTime() < quietDays * DAY_MS) return true;
    }
    if (history.lastShownAt !== null && UPSELL_KINDS.has(kind)) {
      if (now.getTime() - history.lastShownAt.getTime() < prompts.cooldownDays * DAY_MS) return true;
    }
    return false;
  }

  /** The copy variant: the user's stable arm of a running experiment for this kind, else the control. */
  private async withCopy(userId: string, candidate: Candidate): Promise<GrowthPrompt> {
    const experiment = await this.repo.experimentByKey(promptExperimentKey(candidate.kind));
    const variant =
      experiment?.status === "running"
        ? variantFor(userId, experiment.key, experiment.variants)
        : CONTROL_VARIANT;
    const { messageBase, ...prompt } = candidate;
    return { ...prompt, variant, messageKey: `${messageBase}.${variant}` };
  }
}
