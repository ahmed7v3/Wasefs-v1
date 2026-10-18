import type { MeCreditsResponse } from "@wasfa/shared/schemas/credits";

export interface PayerView {
  kind: "personal" | "org";
  orgId?: string;
  orgName?: string;
  /** The balance of the wallet that pays first. */
  balance: number;
  /** Personal credits are used when the organization wallet runs out. */
  fallback: boolean;
  /** The caller's monthly cap in an organization wallet, with what they used this month. */
  memberCap?: { cap: number; used: number };
}

/** Who pays in the requested context, with that wallet's balance; the personal wallet if the org one is missing. */
export function payerView(data: MeCreditsResponse): PayerView {
  const { payer } = data;
  const org =
    payer.kind === "org"
      ? data.wallets.find((wallet) => wallet.kind === "org" && wallet.orgId === payer.orgId)
      : undefined;
  if (!org) return { kind: "personal", balance: data.wallet.balance, fallback: false };
  return {
    kind: "org",
    ...(org.orgId === undefined ? {} : { orgId: org.orgId }),
    ...(org.orgName === undefined ? {} : { orgName: org.orgName }),
    balance: org.balance,
    fallback: payer.fallback,
    ...(org.memberCap === undefined ? {} : { memberCap: org.memberCap }),
  };
}
