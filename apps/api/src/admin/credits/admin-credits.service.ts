import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { isPlaceholderEmail } from "@wasfa/shared/identity";

import { CreditsRepo, type WalletRow } from "../../credits/credits.repo.js";
import { CreditsService } from "../../credits/credits.service.js";
import { ownerKey } from "../../plans/plans.repo.js";
import { PlansService } from "../../plans/plans.service.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { CreditLedgerEntry, CreditWallet as WalletRecord, WalletOwner } from "@wasfa/db";
import type { CursorQuery } from "@wasfa/shared/schemas/admin";
import type {
  AdjustCreditsInput,
  AdminCreditWallet,
  CreditLedgerEntryView,
  CreditWallet,
  PlanSummary,
} from "@wasfa/shared/schemas/credits";

/*
 * Fields kept in the audit row of an adjustment. Ids and dates stay out of `before`/`after` on
 * purpose: the audit redactor scrubs digit runs (phone numbers) and would randomly mangle them. The
 * target id (the wallet) names the owner, and the ledger row holds the timestamp.
 */
export const CREDITS_AUDIT_FIELDS = [
  "balance",
  "delta",
  "reason",
  "ownerType",
  "replayed",
] as const;

const ledgerView = (row: CreditLedgerEntry): CreditLedgerEntryView => ({
  id: row.id,
  kind: row.kind,
  amount: row.amount,
  balanceAfter: row.balanceAfter,
  reason: row.reason,
  actorId: row.actorId,
  reservationId: row.reservationId,
  createdAt: row.createdAt.toISOString(),
});

function ownerOf(row: { ownerUserId: string | null; ownerOrgId: string | null }): WalletOwner {
  if (row.ownerUserId !== null) return { type: "user", id: row.ownerUserId };
  if (row.ownerOrgId !== null) return { type: "org", id: row.ownerOrgId };
  throw new Error("Wallet without an owner");
}

const planSummary = (plan: {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
}): PlanSummary => ({
  id: plan.id,
  key: plan.key,
  nameAr: plan.nameAr,
  nameEn: plan.nameEn,
});

/** The admin side of credits: who has how much, why, and manual corrections. */
@Injectable()
export class AdminCreditsService {
  constructor(
    private readonly repo: CreditsRepo,
    private readonly credits: CreditsService,
    private readonly plans: PlansService,
  ) {}

  async wallets(query: CursorQuery & { q?: string | undefined }) {
    const rows = await this.repo.walletPage(
      query.q,
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    const plans = await this.plans.effectivePlans(page.items.map(ownerOf));
    return {
      items: page.items.map((row): AdminCreditWallet => this.walletView(row, plans)),
      nextCursor: page.nextCursor,
    };
  }

  async ledger(walletId: string, query: CursorQuery) {
    if (!(await this.repo.findWallet(walletId))) throw new AppError(ErrorCode.NOT_FOUND);
    const rows = await this.repo.ledgerPage(
      walletId,
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(ledgerView), nextCursor: page.nextCursor };
  }

  /** Moves a wallet by `delta`, audited with the balance before and after. */
  async adjust(actor: AuthenticatedUser, input: AdjustCreditsInput, audit: AuditScope) {
    const write = await this.credits.adjust(input.owner, input.delta, {
      reason: input.reason,
      actorId: actor.id,
      idempotencyKey: input.idempotencyKey,
    });
    audit.targetId = write.walletId;
    audit.before = { balance: write.balanceBefore, ownerType: input.owner.type };
    audit.after = {
      balance: write.balanceAfter,
      delta: write.entry.amount,
      reason: input.reason,
      replayed: write.replayed,
    };
    const wallet = await this.repo.findWallet(write.walletId);
    if (!wallet) throw new AppError(ErrorCode.NOT_FOUND);
    return {
      wallet: await this.walletRecord(wallet),
      entry: ledgerView(write.entry),
    };
  }

  private async walletRecord(wallet: WalletRecord): Promise<CreditWallet> {
    const owner = ownerOf(wallet);
    const plan = await this.plans.effectivePlan(owner);
    return {
      owner,
      balance: wallet.balance,
      plan: planSummary(plan),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  private walletView(
    row: WalletRow,
    plans: Awaited<ReturnType<PlansService["effectivePlans"]>>,
  ): AdminCreditWallet {
    const owner = ownerOf(row);
    const plan = plans.get(ownerKey(owner));
    if (!plan) throw new Error("No effective plan for a wallet");
    return {
      id: row.id,
      owner,
      ownerName: row.ownerName,
      // Phone-only accounts carry a placeholder address; it is never shown.
      ownerEmail:
        row.ownerEmail === null || isPlaceholderEmail(row.ownerEmail) ? null : row.ownerEmail,
      balance: row.balance,
      plan: planSummary(plan),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
