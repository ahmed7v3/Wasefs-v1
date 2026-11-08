import { Inject, Injectable } from "@nestjs/common";
import {
  CREDITS_LOW_USED_PERCENT,
  EXPIRING_CREDITS_DAYS,
  ORG_USAGE_MIN_ANALYSES,
  ORG_USAGE_MIN_MEMBERS,
  PLAN_EXPIRING_DAYS,
  TASTE_PROMPT_ANALYSIS_NUMBERS,
  isCalmSurface,
  modalAllowed,
  promptCooldownDays,
  promptExperimentKey,
  promptSessionKey,
  variantFor,
  type GrowthPromptKind,
} from "@wasfa/shared/growth";
import { renderPromptText, resolvePromptCatalog } from "@wasfa/shared/growth-prompts";
import { t } from "@wasfa/shared/i18n";
import { rxResultSchema } from "@wasfa/shared/schemas/rx";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { CreditsService, nextGrantAt } from "../credits/credits.service.js";
import { PayerService } from "../orgs/wallet/payer.service.js";
import { PlansService } from "../plans/plans.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { GrowthRepo } from "./growth.repo.js";
import { PromptCopyService, type LocalizedValues } from "./prompt-copy.service.js";
import { TasteService } from "./taste.service.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { PromptEntry } from "@wasfa/shared/growth-prompts";
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
  "trial_ended",
]);

type Candidate = Pick<GrowthPrompt, "kind" | "params" | "cta"> & {
  messageBase: string;
  /** The user's next free renewal date, for `{renewDate}`. */
  renewAt?: Date;
  /** Values that differ per locale (the locked feature's sentence). */
  localized?: LocalizedValues;
};

/**
 * `GrowthService.nextPrompt` of GROWTH-STRATEGY §4: at most one calm, closable card per request,
 * only after a real moment of value. It is side-effect free: the one-per-session reservation is
 * taken when the web reports `prompt_shown`, so a prefetch or a reload never burns the session's
 * prompt. The guardrails of §2 are enforced here, not in the web: the session cap, the per-kind
 * cooldown that doubles with each dismissal (capped), the kill switch, nothing for a result that is
 * not finished (never during an upload, an analysis or an error), and upsells for free accounts only.
 *
 * The copy, form, target plan, destination and cooldown of every kind come from the settings catalog
 * (`growth.prompts.catalog`); the response carries the rendered strings. A modal is returned only for
 * the calm kinds on a calm surface (dashboard, analyze start); anywhere else it is skipped, never
 * downgraded to a card.
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
    private readonly copy: PromptCopyService,
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

    const catalog = resolvePromptCatalog(growth.prompts.catalog);
    const candidates = await this.candidates(user, query, now);
    for (const candidate of candidates) {
      const entry = catalog[candidate.kind];
      if (!entry.enabled) continue;
      // The guard lives here as well as in the settings schema: a stored value can never open a modal
      // on a moment that is not calm, and a calm one never opens on a busy surface.
      if (entry.form === "modal") {
        if (!modalAllowed(candidate.kind) || !isCalmSurface(query.context)) continue;
      }
      const prompts = {
        cooldownDays: entry.cooldownDays ?? growth.prompts.cooldownDays,
        maxCooldownDays: growth.prompts.maxCooldownDays,
      };
      if (await this.coolingDown(user.id, candidate.kind, prompts, now)) continue;
      const prompt = await this.withCopy(user.id, candidate, entry, now);
      if (prompt !== null) return { prompt };
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
          localized: {
            featureLine: {
              ar: t(`growth.prompt.locked_feature.${query.feature}.a`, undefined, "ar"),
              en: t(`growth.prompt.locked_feature.${query.feature}.a`, undefined, "en"),
            },
          },
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

    // dashboard, analyze start and credits
    const analyzeStart = query.context === "analyze_start";
    const expiring = analyzeStart ? null : await this.planExpiring(user.id, now);
    if (expiring && query.context === "dashboard") out.push(expiring);
    const view = await this.credits.forUser(user.id, now);
    const balance = view.wallet.balance;
    const monthly = view.monthlyCredits;
    const nextGrant = new Date(view.nextGrantAt);
    const daysToGrant = Math.ceil((nextGrant.getTime() - now.getTime()) / DAY_MS);
    // The first free credits are gone: once (again only after a dismissal's cooldown), before credits-out.
    if (free && balance === 0 && (await this.trialEnded(user.id, now))) {
      out.unshift({
        kind: "trial_ended",
        messageBase: "growth.prompt.trial_ended",
        params: {},
        renewAt: nextGrant,
        cta: { kind: "pricing", href: "/pricing" },
      });
    }
    if (analyzeStart) {
      // Before any upload: only the moments that stop the person from starting.
      if (free && balance === 0) out.push(this.creditsOut(view.nextGrantAt, nextGrant));
      return out;
    }
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
      out.push(this.creditsOut(view.nextGrantAt, nextGrant));
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

  private creditsOut(nextGrantIso: string, renewAt: Date): Candidate {
    return {
      kind: "credits_out",
      messageBase: "growth.prompt.credits_out",
      params: { date: nextGrantIso.slice(0, 10) },
      renewAt,
      cta: { kind: "pack", href: "/billing#packs" },
    };
  }

  /**
   * The first free credits (trial, else the first monthly grant) are fully spent or expired, and the
   * prompt was not already shown without a dismissal (a click or an ignore is its one showing).
   */
  private async trialEnded(userId: string, now: Date): Promise<boolean> {
    const trial = await this.repo.trialCredits(userId);
    if (trial === null || trial.granted <= 0 || trial.consumed < trial.granted) return false;
    const history = await this.repo.promptHistory(userId, "trial_ended", now);
    return history.lastShownAt === null || history.dismissals > 0;
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

  /**
   * The copy variant: the user's stable arm of a running experiment for this kind, else the control.
   * The control carries the catalog copy rendered with real plan values; an experiment arm keeps its
   * dictionary text and is always a card. `null` when a placeholder cannot be filled (no plan on
   * sale): a person never reads a template.
   */
  private async withCopy(
    userId: string,
    candidate: Candidate,
    entry: PromptEntry,
    now: Date,
  ): Promise<GrowthPrompt | null> {
    const experiment = await this.repo.experimentByKey(promptExperimentKey(candidate.kind));
    const variant =
      experiment?.status === "running"
        ? variantFor(userId, experiment.key, experiment.variants)
        : CONTROL_VARIANT;
    const { messageBase, renewAt, localized, ...prompt } = candidate;
    const base = { ...prompt, variant, messageKey: `${messageBase}.${variant}` };
    if (variant !== CONTROL_VARIANT) return { ...base, form: "inline", content: null };

    const plan = this.copy.usesPlan(entry) ? await this.copy.planFacts(entry.targetPlan, now) : null;
    const content = this.copy.render({
      entry,
      plan,
      renewAt: renewAt ?? nextGrantAt(now),
      params: candidate.params,
      ...(localized ? { localized } : {}),
    });
    if (!this.copy.isComplete(content)) return null;
    const href =
      entry.cta.href === null
        ? candidate.cta.href
        : renderPromptText(entry.cta.href, this.hrefValues(candidate));
    return {
      ...base,
      cta: { kind: candidate.cta.kind, ...(href !== undefined ? { href } : {}) },
      form: entry.form,
      content,
      ...(entry.secondaryHref !== undefined ? { secondaryHref: entry.secondaryHref } : {}),
    };
  }

  /** Values a destination may carry: the moment's params and the ids in its own default link. */
  private hrefValues(candidate: Candidate): Record<string, string> {
    const link = candidate.cta.href ?? "";
    const org = /[?&]org=([^&]+)/.exec(link)?.[1];
    const sub = /[?&]sub=([^&]+)/.exec(link)?.[1];
    return {
      ...Object.fromEntries(Object.entries(candidate.params).map(([key, value]) => [key, String(value)])),
      ...(org ? { orgId: org } : {}),
      ...(sub ? { subId: sub } : {}),
    };
  }
}
