import { Injectable } from "@nestjs/common";
import { normalizeDigits } from "@wasfa/shared/schemas/phone";
import { maskEmail, maskPhone } from "@wasfa/shared/subscriptions";

import { hasPermission, type AuthenticatedUser } from "../../common/current-user.js";

import { AdminSearchRepo } from "./admin-search.repo.js";

const HEX_FRAGMENT = /^[0-9a-f]{4,}$/i;

/** One result of the admin search palette. */
export interface SearchItem {
  type: "user" | "order" | "payment" | "coupon" | "referral_code";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Cross-entity lookup for the admin palette. A group is queried only when the caller holds its
 * permission, so a support agent never learns that an order or payment exists. Contact details of
 * users are masked in the subtitle.
 */
@Injectable()
export class AdminSearchService {
  constructor(private readonly repo: AdminSearchRepo) {}

  async search(query: string, caller: AuthenticatedUser) {
    const text = query.trim();
    // Phone numbers may be typed with Arabic-Indic digits, spaces or dashes.
    const phoneDigits = normalizeDigits(text).replace(/\D/g, "");
    const idPrefix = HEX_FRAGMENT.test(text) ? text.toLowerCase() : "";
    const canBilling = hasPermission(caller, "billing.read");

    const [userRows, orderRows, paymentRows, couponRows, referralRows] = await Promise.all([
      hasPermission(caller, "users.read")
        ? this.repo.users({ text, phoneDigits, idPrefix })
        : Promise.resolve([]),
      canBilling ? this.repo.orders(text, idPrefix) : Promise.resolve([]),
      canBilling ? this.repo.payments(text, idPrefix) : Promise.resolve([]),
      canBilling ? this.repo.coupons(text.toUpperCase()) : Promise.resolve([]),
      hasPermission(caller, "referrals.read")
        ? this.repo.referralCodes(text.toUpperCase())
        : Promise.resolve([]),
    ]);

    const items: SearchItem[] = [
      ...userRows.map((row) => ({
        type: "user" as const,
        id: row.id,
        title: row.name,
        subtitle: [row.phone ? maskPhone(row.phone) : null, maskEmail(row.email)]
          .filter((part) => part !== null)
          .join(" · "),
        href: `/admin/users/${row.id}`,
      })),
      ...orderRows.map((row) => ({
        type: "order" as const,
        id: row.id,
        title: row.number,
        subtitle: row.status,
        href: `/admin/billing/orders?open=${row.id}`,
      })),
      ...paymentRows.map((row) => ({
        type: "payment" as const,
        id: row.id,
        title: row.reference,
        subtitle: row.status,
        href: `/admin/billing/payments?open=${row.id}`,
      })),
      ...couponRows.map((row) => ({
        type: "coupon" as const,
        id: row.id,
        title: row.code,
        subtitle: row.status,
        href: `/admin/billing/coupons?open=${row.id}`,
      })),
      ...referralRows.map((row) => ({
        type: "referral_code" as const,
        id: row.id,
        title: row.code,
        subtitle: "",
        href: `/admin/growth/referrals?code=${row.id}`,
      })),
    ];
    return { items, userResultCount: userRows.length };
  }
}
