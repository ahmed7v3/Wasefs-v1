import { Inject, Injectable } from "@nestjs/common";
import { setMarketingOptOut, verifyUnsubscribeToken, type GrowthEventRecord } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  GROWTH_PROMPT_KINDS,
  PROMPT_SESSION_TTL_SECONDS,
  promptExperimentKey,
  promptSessionKey,
  variantFor,
  type GrowthEventName,
  type GrowthPromptKind,
  type MarketingOptOutVia,
} from "@wasfa/shared/growth";
import {
  growthEventInputSchema,
  isForbiddenGrowthProp,
  type PersonalOfferView,
  type PublicProofResponse,
  type ValueLedgerResponse,
} from "@wasfa/shared/schemas/growth";
import { Redis } from "ioredis";

import { DB, type DbHandle } from "../common/database.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";
import { SettingsService } from "../settings/settings.service.js";

import { GrowthRepo } from "./growth.repo.js";

const DAY_MS = 86_400_000;
const PROOF_CACHE_KEY = "growth:proof";
const PROOF_CACHE_SECONDS = 3_600;

/**
 * What a browser may report itself. Payments, proofs, coupons, offers used, tastes and referrals are
 * written by the server where they happen; a client copy of those would let anyone fake a funnel.
 */
const CLIENT_EVENTS: ReadonlySet<GrowthEventName> = new Set([
  "pricing_viewed",
  "plan_selected",
  "method_selected",
  "prompt_shown",
  "prompt_clicked",
  "prompt_dismissed",
  "offer_shown",
  "referral_link_opened",
]);
/** Before sign-in only these make sense; the rest belong to a person. */
const ANONYMOUS_EVENTS: ReadonlySet<GrowthEventName> = new Set([
  "pricing_viewed",
  "plan_selected",
  "referral_link_opened",
]);
const PROMPT_EVENTS: ReadonlySet<GrowthEventName> = new Set([
  "prompt_shown",
  "prompt_clicked",
  "prompt_dismissed",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class GrowthService {
  private readonly key: Buffer;

  constructor(
    private readonly repo: GrowthRepo,
    private readonly settings: SettingsService,
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.key = encryptionKey(env);
  }

  // --- Personal offers, value, proof -----------------------------------------------------------------

  /** Open personal offers with their server deadline: the only deadline any countdown may show. */
  async offers(userId: string, now = new Date()): Promise<{ offers: PersonalOfferView[] }> {
    const growth = await this.settings.get("growth");
    if (growth.killSwitch) return { offers: [] };
    const rows = await this.repo.activeOffers(userId, now);
    return {
      offers: rows.flatMap(({ offer, promotion }) =>
        promotion === null
          ? []
          : [
              {
                id: offer.id,
                kind: offer.kind,
                expiresAt: offer.expiresAt.toISOString(),
                discount: {
                  kind: promotion.kind,
                  value: promotion.value,
                  currency: promotion.currency,
                },
                titleAr: promotion.titleAr,
                titleEn: promotion.titleEn,
              },
            ],
      ),
    };
  }

  async value(userId: string): Promise<ValueLedgerResponse> {
    const [{ analyses, drugs }, growth] = await Promise.all([
      this.repo.valueOf(userId),
      this.settings.get("growth"),
    ]);
    return {
      analyses,
      drugsChecked: drugs,
      minutesSavedEstimate: analyses * growth.value.minutesSavedPerAnalysis,
      estimate: true,
    };
  }

  /**
   * Social proof that is true or absent (GROWTH §8): the week's count only above `proof.minCount`,
   * "most chosen" only for the plan with the largest share of paid subscriptions in 30 days and a
   * sample of at least `mostChosen.minSample`. Cached for an hour.
   */
  async proof(now = new Date()): Promise<PublicProofResponse> {
    const cached = await this.redis.get(PROOF_CACHE_KEY);
    if (cached !== null) return JSON.parse(cached) as PublicProofResponse;
    const growth = await this.settings.get("growth");
    const result: PublicProofResponse = {};
    const week = await this.repo.analysesSince(new Date(now.getTime() - 7 * DAY_MS));
    if (week >= growth.proof.minCount && growth.proof.minCount > 0) result.analysesThisWeek = week;
    const shares = await this.repo.paidSubscriptionShare(new Date(now.getTime() - 30 * DAY_MS));
    const sample = shares.reduce((sum, share) => sum + share.total, 0);
    const [top, second] = shares;
    // A tie is not "the most chosen".
    if (top && sample >= growth.mostChosen.minSample && (!second || top.total > second.total)) {
      result.mostChosenPlanKey = top.planKey;
    }
    await this.redis.set(PROOF_CACHE_KEY, JSON.stringify(result), "EX", PROOF_CACHE_SECONDS);
    return result;
  }

  /** The caller's stable arm in each running experiment. */
  async assignments(userId: string) {
    const running = await this.repo.runningExperiments();
    return {
      assignments: running.map((experiment) => ({
        experimentKey: experiment.key,
        variant: variantFor(userId, experiment.key, experiment.variants),
      })),
    };
  }

  // --- Event intake --------------------------------------------------------------------------------------

  /**
   * Client events, checked one by one: an unknown name, a server-only event, a prop that could carry
   * personal data or a bad shape drops that event only. Prompt events need a signed-in user and a
   * known kind; their variant is recomputed here (a client cannot move itself into another arm), and
   * `prompt_shown` takes the session's prompt slot.
   */
  async ingest(
    userId: string | null,
    events: readonly unknown[],
  ): Promise<{ accepted: number; dropped: number }> {
    let accepted = 0;
    for (const raw of events) {
      const record = await this.toRecord(userId, raw);
      if (record === null) continue;
      if (await this.repo.recordEvent(record)) {
        accepted += 1;
        await this.afterRecorded(userId, record);
      }
    }
    return { accepted, dropped: events.length - accepted };
  }

  private async toRecord(userId: string | null, raw: unknown): Promise<GrowthEventRecord | null> {
    const parsed = growthEventInputSchema.safeParse(raw);
    if (!parsed.success) return null;
    const event = parsed.data;
    if (!CLIENT_EVENTS.has(event.name)) return null;
    if (userId === null && !ANONYMOUS_EVENTS.has(event.name)) return null;
    for (const [key, value] of Object.entries(event.props)) {
      if (isForbiddenGrowthProp(key, value)) return null;
    }
    let variant = event.variant;
    if (PROMPT_EVENTS.has(event.name)) {
      const kind = event.props["kind"];
      if (typeof kind !== "string" || !(GROWTH_PROMPT_KINDS as readonly string[]).includes(kind)) {
        return null;
      }
      variant = await this.promptVariant(userId as string, kind as GrowthPromptKind);
    }
    if (event.name === "offer_shown") {
      const offer = event.props["offer"];
      if (typeof offer !== "string" || !UUID.test(offer)) return null;
    }
    return {
      name: event.name,
      sessionId: event.sessionId,
      userId,
      props: event.props,
      variant,
    };
  }

  private async promptVariant(userId: string, kind: GrowthPromptKind): Promise<string> {
    const experiment = await this.repo.experimentByKey(promptExperimentKey(kind));
    return experiment?.status === "running"
      ? variantFor(userId, experiment.key, experiment.variants)
      : "a";
  }

  private async afterRecorded(userId: string | null, record: GrowthEventRecord): Promise<void> {
    if (record.name === "prompt_shown") {
      const key = promptSessionKey(record.sessionId);
      await this.redis.multi().incr(key).expire(key, PROMPT_SESSION_TTL_SECONDS).exec();
    }
    if (record.name === "offer_shown" && userId !== null) {
      await this.repo.markOfferShown(userId, String(record.props?.["offer"]));
    }
  }

  // --- Unsubscribe ------------------------------------------------------------------------------------------

  /** Turns marketing mail off for the token's user. Idempotent; a bad token is `NOT_FOUND`. */
  async unsubscribe(token: string, via: MarketingOptOutVia): Promise<{ unsubscribed: true }> {
    const userId = verifyUnsubscribeToken(this.key, token);
    if (userId === null) throw new AppError(ErrorCode.NOT_FOUND);
    await setMarketingOptOut(this.handle.db, userId, via);
    return { unsubscribed: true };
  }
}
