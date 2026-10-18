import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  GROWTH_FUNNEL_MAX_DAYS,
  type CreateExperimentInput,
  type ExperimentResultsResponse,
  type ExperimentView,
  type GrowthFunnelQuery,
  type GrowthFunnelResponse,
  type UpdateExperimentInput,
} from "@wasfa/shared/schemas/growth";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { SettingsService } from "../../settings/settings.service.js";

import { AdminExperimentsRepo, type VariantCounts } from "./admin-experiments.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { Experiment } from "@wasfa/db";
import type { ExperimentStatus } from "@wasfa/shared/growth";

const DAY_MS = 86_400_000;
const FUNNEL_CACHE_SECONDS = 60;

/** Allowed status moves: a completed experiment is final, a stopped one can only be completed. */
const TRANSITIONS: Record<"start" | "stop" | "complete", { from: ExperimentStatus[]; to: ExperimentStatus }> = {
  start: { from: ["draft"], to: "running" },
  stop: { from: ["running"], to: "stopped" },
  complete: { from: ["running", "stopped"], to: "completed" },
};

const bps = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part * 10_000) / whole));
const step = (from: number, to: number) => ({ from, to, rateBps: bps(to, from) });

function view(row: Experiment): ExperimentView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    flagKey: row.flagKey,
    variants: row.variants,
    status: row.status,
    minSampleSize: row.minSampleSize,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Experiments and the funnel of GROWTH §9 (ADMIN-CONSOLE-SPEC §6.5). A variant that converts better
 * but worsens a guardrail (refunds, support contacts, dismissals, unsubscribes) beyond
 * `growth.experiments.guardrailBps` against the control is flagged red: never promoted blindly.
 */
@Injectable()
export class AdminExperimentsService {
  constructor(
    private readonly repo: AdminExperimentsRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async list() {
    return { items: (await this.repo.list()).map(view) };
  }

  private async require(id: string): Promise<Experiment> {
    const row = await this.repo.find(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return row;
  }

  async create(input: CreateExperimentInput, audit: AuditScope) {
    // Every experiment starts as a draft: running it is its own audited step.
    const row = await this.repo.create(input);
    if (!row) throw new AppError(ErrorCode.CONFLICT, { details: { reason: "key_taken" } });
    audit.targetId = row.id;
    audit.after = { key: row.key, variants: row.variants };
    return view(row);
  }

  async update(id: string, input: UpdateExperimentInput, audit: AuditScope) {
    const before = await this.require(id);
    // Changing the arms of a running experiment would move people between variants mid-test.
    if (input.variants !== undefined && before.status !== "draft") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_draft" } });
    }
    const row = await this.repo.update(id, input);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = id;
    audit.before = { name: before.name, variants: before.variants, minSampleSize: before.minSampleSize };
    audit.after = { name: row.name, variants: row.variants, minSampleSize: row.minSampleSize };
    return view(row);
  }

  async transition(id: string, action: keyof typeof TRANSITIONS, audit: AuditScope) {
    const before = await this.require(id);
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(before.status)) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "invalid_transition" } });
    }
    const now = new Date();
    const row = await this.repo.update(id, {
      status: rule.to,
      ...(action === "start" ? { startedAt: now } : {}),
      ...(action !== "start" && before.endedAt === null ? { endedAt: now } : {}),
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = id;
    audit.before = { status: before.status };
    audit.after = { status: row.status };
    return view(row);
  }

  async results(id: string): Promise<ExperimentResultsResponse> {
    const experiment = await this.require(id);
    const growth = await this.settings.get("growth");
    const minSample = experiment.minSampleSize ?? growth.experiments.minSampleSize;
    const guardrailBps = growth.experiments.guardrailBps;
    const control = experiment.variants[0]?.key ?? "a";
    const from = experiment.startedAt ?? experiment.createdAt;
    const to = experiment.endedAt ?? new Date();
    const counts = await this.repo.variantCounts(experiment, from, to);
    const byVariant = new Map(counts.map((row) => [row.variant, row]));
    const empty = (variant: string): VariantCounts => ({
      variant,
      exposures: 0,
      conversions: 0,
      refunds: 0,
      supportContacts: 0,
      promptDismissals: 0,
      unsubscribes: 0,
    });
    const rates = (row: VariantCounts) => ({
      refundBps: bps(row.refunds, row.exposures),
      supportBps: bps(row.supportContacts, row.exposures),
      dismissalBps: bps(row.promptDismissals, row.exposures),
      unsubscribeBps: bps(row.unsubscribes, row.exposures),
    });
    const controlRates = rates(byVariant.get(control) ?? empty(control));
    const variants = experiment.variants.map(({ key }) => {
      const row = byVariant.get(key) ?? empty(key);
      const guardrails = rates(row);
      const flaggedReasons: ExperimentResultsResponse["variants"][number]["flaggedReasons"] = [];
      if (key !== control) {
        if (guardrails.refundBps - controlRates.refundBps > guardrailBps) flaggedReasons.push("refunds");
        if (guardrails.supportBps - controlRates.supportBps > guardrailBps) flaggedReasons.push("support");
        if (guardrails.dismissalBps - controlRates.dismissalBps > guardrailBps) {
          flaggedReasons.push("dismissals");
        }
        if (guardrails.unsubscribeBps - controlRates.unsubscribeBps > guardrailBps) {
          flaggedReasons.push("unsubscribes");
        }
      }
      return {
        ...row,
        conversionBps: bps(row.conversions, row.exposures),
        guardrails,
        flaggedRed: flaggedReasons.length > 0,
        flaggedReasons,
        sampleReached: row.exposures >= minSample,
      };
    });
    return {
      experiment: view(experiment),
      minSampleSize: minSample,
      guardrailBps,
      controlVariant: control,
      variants,
      minSampleReached: variants.every((variant) => variant.sampleReached),
    };
  }

  /** The funnel for a window (default: the last 30 days), cached for a minute per query. */
  async funnel(query: GrowthFunnelQuery, now = new Date()): Promise<GrowthFunnelResponse> {
    const to = query.to ?? now;
    const from = query.from ?? new Date(to.getTime() - 30 * DAY_MS);
    if (to.getTime() - from.getTime() > GROWTH_FUNNEL_MAX_DAYS * DAY_MS) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["from"] } });
    }
    const cacheKey = `growth:funnel:${from.toISOString()}:${to.toISOString()}:${query.experiment ?? ""}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return JSON.parse(cached) as GrowthFunnelResponse;

    const promptKind = query.experiment?.startsWith("prompt_") ? query.experiment.slice(7) : null;
    const counts = await this.repo.funnel(from, to, promptKind);
    const response: GrowthFunnelResponse = {
      generatedAt: now.toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
      experiment: query.experiment ?? null,
      visitToSignup: step(counts.pricingSessions, counts.signups),
      signupToActivation: step(counts.signups, counts.activated),
      activationToPaid: step(counts.activated, counts.activatedPaid),
      checkoutToPaid: step(counts.ordersCreated, counts.ordersPaid),
      methodMix: counts.methodMix,
      prompts: counts.prompts,
      tastes: { started: counts.tastesStarted, completed: counts.tastesCompleted },
      offers: { shown: counts.offersShown, used: counts.offersUsed },
      referral: {
        signups: counts.referralSignups,
        paid: counts.referralPaid,
        // (invitees / inviters) x (paid / invitees) = paid per inviter, in thousandths.
        kFactorMilli:
          counts.inviters === 0 ? 0 : Math.round((counts.referralPaid * 1_000) / counts.inviters),
      },
    };
    await this.redis.set(cacheKey, JSON.stringify(response), "EX", FUNNEL_CACHE_SECONDS);
    return response;
  }
}
