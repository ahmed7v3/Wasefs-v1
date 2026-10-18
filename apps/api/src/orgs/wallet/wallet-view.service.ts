import { Injectable } from "@nestjs/common";

import { CreditsService } from "../../credits/credits.service.js";
import { OrgsRepo } from "../orgs.repo.js";

import { PayerService } from "./payer.service.js";
import { OrgWalletRepo, monthWindow } from "./wallet.repo.js";

import type { MeCreditsResponse } from "@wasfa/shared/schemas/credits";

type Wallet = MeCreditsResponse["wallets"][number];

/**
 * `GET /me/credits?orgId=`: the personal answer of `CreditsService.forUser` plus every wallet the
 * caller can spend from and which one pays in the requested context (BILLING §8: the UI always
 * shows the payer).
 */
@Injectable()
export class WalletViewService {
  constructor(
    private readonly credits: CreditsService,
    private readonly orgs: OrgsRepo,
    private readonly wallets: OrgWalletRepo,
    private readonly payer: PayerService,
  ) {}

  async forUser(userId: string, orgId?: string, now = new Date()): Promise<MeCreditsResponse> {
    // Resolved first: a context the caller cannot act in is refused before anything is read.
    const ctx = await this.payer.resolve(userId, orgId);
    const base = await this.credits.forUser(userId, now);

    const memberships = await this.orgs.listForUser(userId);
    const since = monthWindow(now).start;
    const orgWallets: Wallet[] = [];
    for (const { org } of memberships) {
      const [balance, cap] = await Promise.all([
        this.wallets.balance(org.id),
        this.wallets.memberCap(org.id, userId),
      ]);
      const memberCap =
        cap === null
          ? undefined
          : { cap, used: await this.wallets.memberUsed(org.id, userId, since) };
      orgWallets.push({
        kind: "org",
        orgId: org.id,
        orgName: org.name,
        balance,
        ...(memberCap ? { memberCap } : {}),
      });
    }

    return {
      ...base,
      wallets: [...base.wallets, ...orgWallets],
      payer:
        ctx.orgId === null
          ? { kind: "personal", fallback: false }
          : { kind: "org", orgId: ctx.orgId, fallback: ctx.allowFallback },
    };
  }
}
