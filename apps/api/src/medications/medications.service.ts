import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { MEDICATION_PAGE_SIZE } from "@wasfa/shared/schemas/medications";

import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { SettingsService } from "../settings/settings.service.js";

import { MedicationsRepo } from "./medications.repo.js";

import type {
  MedicationDetailResponse,
  MedicationSearchQuery,
  MedicationSearchResponse,
  MedicationSummary,
} from "@wasfa/shared/schemas/medications";

/** Alternatives shown on a medication's page. */
export const MEDICATION_ALTERNATIVES_SHOWN = 10;
export const MEDICATION_RATE_PER_MINUTE = 60;

/** Prices are approximate and the admin may switch them off: the amount and its date both go. */
export function withoutPrice<T extends { priceMinor: number | null; priceUpdatedAt: string | null }>(
  item: T,
): T {
  return { ...item, priceMinor: null, priceUpdatedAt: null };
}

/** Medication search for signed-in users (docs/MEDICATIONS.md section 6). No AI, no credits. */
@Injectable()
export class MedicationsService {
  constructor(
    private readonly repo: MedicationsRepo,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
  ) {}

  /** 60 requests a minute per signed-in user, on top of the route's per-address limit. */
  private async throttle(userId: string): Promise<void> {
    await this.limiter.hit(`medications:user:${userId}`, MEDICATION_RATE_PER_MINUTE, 60);
  }

  /** The admin switches: with the database or its search off the feature does not exist. */
  private async gate() {
    const { enabled, search } = await this.settings.get("medications");
    if (!enabled || !search.enabled) {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { reason: "feature_off" } });
    }
    return search;
  }

  async search(userId: string, query: MedicationSearchQuery): Promise<MedicationSearchResponse> {
    const { showPrices } = await this.gate();
    await this.throttle(userId);
    const page = await this.repo.search({
      q: query.q,
      category: query.category,
      cursor: query.cursor,
      limit: MEDICATION_PAGE_SIZE,
    });
    return {
      items: showPrices ? page.items : page.items.map((item) => withoutPrice(item)),
      nextCursor: page.nextCursor,
    };
  }

  async get(userId: string, id: string): Promise<MedicationDetailResponse> {
    const { showPrices } = await this.gate();
    await this.throttle(userId);
    const medication = await this.repo.find(id);
    // A withdrawn entry is not shown to users, as in search.
    if (!medication || medication.status === "withdrawn") throw new AppError(ErrorCode.NOT_FOUND);
    const alternatives = await this.repo.alternatives(id, MEDICATION_ALTERNATIVES_SHOWN);
    if (showPrices) return { medication, alternatives };
    return {
      medication: { ...withoutPrice(medication), oldPriceMinor: null },
      alternatives: alternatives.map((item: MedicationSummary) => withoutPrice(item)),
    };
  }
}
