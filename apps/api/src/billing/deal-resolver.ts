import { Inject, Injectable } from "@nestjs/common";
import { engineDealOf, orgBillingMode, resolveDeal, type DealResolution } from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

import type { DealTerms } from "@wasfa/shared/price-engine";

export const DEAL_RESOLVER = Symbol("DEAL_RESOLVER");

/** What the engine takes as `deal`: the one winning deal of the owner for this purchase. */
export type EngineDeal = DealTerms;

/** Who is buying: a person (personal quote) or an organization (organization quote). */
export interface DealOwner {
  ownerUserId?: string | undefined;
  ownerOrgId?: string | undefined;
  /** The simulator's "a new member of this organization". */
  newMemberOfOrgId?: string | undefined;
}

export interface DealResolver {
  resolve(
    owner: DealOwner,
    planKey: string,
    months: number,
    currency: string,
    now: Date,
  ): Promise<EngineDeal | null>;
  /** The same decision with the reasons every candidate won or lost (simulators). */
  explain(
    owner: DealOwner,
    planKey: string,
    months: number,
    currency: string,
    now: Date,
  ): Promise<DealResolution>;
  /** True when the organization's deal is `manual_invoice`: it pays offline, not at checkout. */
  isManualInvoice(orgId: string, now: Date): Promise<boolean>;
}

/** Deals from the database (`@wasfa/db` `resolveDeal`); see that module for the precedence rules. */
@Injectable()
export class DbDealResolver implements DealResolver {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async resolve(
    owner: DealOwner,
    planKey: string,
    months: number,
    currency: string,
    now: Date,
  ): Promise<EngineDeal | null> {
    return engineDealOf(await this.explain(owner, planKey, months, currency, now));
  }

  explain(
    owner: DealOwner,
    planKey: string,
    months: number,
    currency: string,
    now: Date,
  ): Promise<DealResolution> {
    return resolveDeal(this.handle.db, { ...owner, planKey, months, currency, now });
  }

  async isManualInvoice(orgId: string, now: Date): Promise<boolean> {
    return (await orgBillingMode(this.handle.db, orgId, now)) === "manual_invoice";
  }
}
