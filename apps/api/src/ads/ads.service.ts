import { randomInt } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  PAGE_CLASSES,
  adCounterKey,
  type AdSlotQuery,
  type AdSlotView,
  type AdsSettings,
} from "@wasfa/shared/ads";
import { Redis } from "ioredis";

import { LocalCache } from "../common/local-cache.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { PlansService } from "../plans/plans.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { pickAdImage } from "./ads-image.js";
import { selectCreative, type AdContext, type AdOnPage, type Rng } from "./ads-selection.js";
import { signAdToken, utcDay, verifyAdToken, type AdTokenClaims } from "./ads-token.js";
import { AdsRepo, type CreativeCandidateRow } from "./ads.repo.js";

import type { ApiEnv } from "../config/env.js";
import type { AdCreativeRow, AdPlacementRow } from "@wasfa/db";

/** Placements and approved creatives change by hand a few times a day: a short cache is plenty. */
const SNAPSHOT_TTL_MS = 15_000;
const COUNTER_TTL_SECONDS = 3 * 24 * 60 * 60;
const DEFAULT_IMAGE_WIDTH = 640;
const MAX_ALREADY = 10;

interface Snapshot {
  placements: Map<string, AdPlacementRow>;
  candidates: CreativeCandidateRow[];
}

/** A uniform [0, 1) draw from the system CSPRNG; tests inject their own through `AdsService.rng`. */
const secureRng: Rng = () => randomInt(0, 2 ** 31) / 2 ** 31;

@Injectable()
export class AdsService {
  private readonly cache = new LocalCache<Snapshot>(SNAPSHOT_TTL_MS);
  /** Injectable for tests (seeded); production uses the CSPRNG. */
  rng: Rng = secureRng;

  constructor(
    private readonly repo: AdsRepo,
    private readonly settings: SettingsService,
    private readonly plans: PlansService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV)
    private readonly env: Pick<ApiEnv, "BETTER_AUTH_SECRET" | "MEDIA_PUBLIC_ORIGIN">,
  ) {}

  private async snapshot(): Promise<Snapshot> {
    const cached = this.cache.get("all");
    if (cached) return cached;
    const [placements, candidates] = await Promise.all([
      this.repo.placements(),
      this.repo.approvedCreatives(),
    ]);
    const snapshot = {
      placements: new Map(placements.map((placement) => [placement.key, placement])),
      candidates,
    };
    this.cache.set("all", snapshot);
    return snapshot;
  }

  /** True when the user's plan is ad-free (paid plans by default). Nothing but the plan flag is read. */
  async isAdsFree(userId: string | null): Promise<boolean> {
    if (userId === null) return false;
    const plan = await this.plans.effectivePlan({ type: "user", id: userId });
    return plan.adsFree;
  }

  /** The creative to show in `placementKey`, or `null`: every rule of the floor lives in `selectCreative`. */
  async pick(
    placementKey: string,
    ctx: AdContext,
    now = new Date(),
  ): Promise<AdCreativeRow | null> {
    const settings = await this.settings.get("ads");
    return (await this.pickWith(placementKey, ctx, settings, now))?.candidate.creative ?? null;
  }

  private async pickWith(placementKey: string, ctx: AdContext, settings: AdsSettings, now: Date) {
    const { placements, candidates } = await this.snapshot();
    const placement = placements.get(placementKey);
    if (!placement) return null;
    const creative = selectCreative({ placement, candidates, settings, ctx, now, rng: this.rng });
    if (!creative) return null;
    const candidate = candidates.find((entry) => entry.creative.id === creative.id);
    return candidate ? { placement, candidate } : null;
  }

  /** The public slot: render data and a signed token, or `{ slot: null }` so the page collapses it. */
  async slot(
    query: AdSlotQuery,
    userId: string | null,
    now = new Date(),
  ): Promise<{ slot: AdSlotView | null }> {
    if (!PAGE_CLASSES.includes(query.pageClass)) return { slot: null };
    const settings = await this.settings.get("ads");
    if (!settings.enabled) return { slot: null };

    const ctx: AdContext = {
      pageClass: query.pageClass,
      device: query.device,
      locale: query.locale,
      country: query.country,
      userEntitlements: { adsFree: await this.isAdsFree(userId) },
      alreadyOnPage: await this.resolveAlready(query.already),
    };
    const picked = await this.pickWith(query.placement, ctx, settings, now);
    if (!picked) return { slot: null };

    const { placement, candidate } = picked;
    const { creative } = candidate;
    const token = signAdToken(
      this.env.BETTER_AUTH_SECRET,
      { creativeId: creative.id, placement: placement.key, day: utcDay(now), channel: "web" },
      now,
    );
    const banner = placement.format === "bottom_banner";
    return {
      slot: {
        creativeId: creative.id,
        token,
        placement: placement.key,
        format: placement.format,
        sizeDesktop: placement.sizeDesktop,
        sizeMobile: placement.sizeMobile,
        closable: placement.closable || banner,
        dismissDays: banner ? settings.bottomBanner.dismissDays : placement.dismissDays,
        creative: {
          title: creative.title,
          alt: creative.alt,
          image: this.imageOf(candidate, placement),
          advertiserName: candidate.advertiserName,
        },
      },
    };
  }

  private async resolveAlready(raw: string | undefined): Promise<AdOnPage[]> {
    const pairs = (raw ?? "")
      .split(",")
      .map((part) => part.split(":"))
      .flatMap(([placement, creativeId]) =>
        placement && creativeId ? [{ placement, creativeId }] : [],
      )
      .slice(0, MAX_ALREADY);
    const advertisers = new Map(
      (await this.repo.advertisersOfCreatives(pairs.map((pair) => pair.creativeId))).map((row) => [
        row.id,
        row.advertiserId,
      ]),
    );
    return pairs.map((pair) => ({
      ...pair,
      advertiserId: advertisers.get(pair.creativeId) ?? null,
    }));
  }

  /** See `pickAdImage`: shared with the admin preview so both show the same variant. */
  private imageOf(candidate: CreativeCandidateRow, placement: AdPlacementRow) {
    const wanted = Number(/^(d+)x/.exec(placement.sizeDesktop)?.[1] ?? DEFAULT_IMAGE_WIDTH);
    return pickAdImage(candidate.media, wanted, this.env.MEDIA_PUBLIC_ORIGIN);
  }

  /** Counts one impression per distinct valid token of the batch. */
  async recordImpressions(tokens: readonly string[], now = new Date()): Promise<number> {
    const claims = [...new Set(tokens)].flatMap((token) => {
      const verified = verifyAdToken(this.env.BETTER_AUTH_SECRET, token, now);
      return verified ? [verified] : [];
    });
    if (claims.length === 0) return 0;
    const pipeline = this.redis.pipeline();
    for (const claim of claims) this.count(pipeline, claim, "i");
    await pipeline.exec();
    return claims.length;
  }

  /** Verifies the token, counts the click and returns the destination, or `null` for a bad token. */
  async recordClick(token: string, now = new Date()): Promise<string | null> {
    const claims = verifyAdToken(this.env.BETTER_AUTH_SECRET, token, now);
    if (!claims) return null;
    const url = await this.repo.clickTarget(claims.creativeId);
    if (!url) return null;
    const pipeline = this.redis.pipeline();
    this.count(pipeline, claims, "c");
    await pipeline.exec();
    return url;
  }

  private count(
    pipeline: ReturnType<Redis["pipeline"]>,
    claims: AdTokenClaims,
    kind: "i" | "c",
  ): void {
    const key = adCounterKey({
      creativeId: claims.creativeId,
      placement: claims.placement,
      day: claims.day,
      channel: claims.channel,
      kind,
    });
    pipeline.incr(key).expire(key, COUNTER_TTL_SECONDS);
  }
}
