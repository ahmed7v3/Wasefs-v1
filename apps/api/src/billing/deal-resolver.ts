import { Injectable } from "@nestjs/common";

import type { DealTerms } from "@wasfa/shared/price-engine";

export const DEAL_RESOLVER = Symbol("DEAL_RESOLVER");

/** What the engine takes as `deal`: the most specific active deal of the owner for this purchase. */
export type EngineDeal = DealTerms;

export interface DealResolver {
  resolve(
    ownerUserId: string,
    planKey: string,
    months: number,
    currency: string,
    now: Date,
  ): Promise<EngineDeal | null>;
}

/**
 * No deals yet. Task 3.10 (WP6) replaces this binding with the real resolver; until then every
 * quote is priced from the catalog alone.
 */
@Injectable()
export class NullDealResolver implements DealResolver {
  resolve(): Promise<EngineDeal | null> {
    return Promise.resolve(null);
  }
}
