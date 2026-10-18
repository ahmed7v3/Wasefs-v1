import { Inject, Injectable } from "@nestjs/common";
import { coupons, orders, payments, referralCodes, users } from "@wasfa/db";
import { ilike, or, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { escapeLike } from "../common/keyset.js";

/** Results per group: the palette shows a handful, the full lists have their own pages. */
const GROUP_LIMIT = 5;

const prefixOf = (text: string) => `${escapeLike(text)}%`;

export interface UserSearchTerms {
  /** The text as typed: matches an e-mail address or a name from its start. */
  text: string;
  /** Digits of a phone number as typed (any script already folded to ASCII); may be empty. */
  phoneDigits: string;
  /** Lower-case hex of at least four characters; empty when the text is not an id fragment. */
  idPrefix: string;
}

@Injectable()
export class AdminSearchRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  users({ text, phoneDigits, idPrefix }: UserSearchTerms) {
    const pattern = prefixOf(text);
    const matches: SQL[] = [ilike(users.email, pattern), ilike(users.name, pattern)];
    // An agent types the part of an address they remember (`gmail`, `ahmed.s`): from three characters
    // on, any part of the e-mail matches, not only its start.
    if (text.length >= 3) matches.push(ilike(users.email, `%${escapeLike(text)}%`));
    if (phoneDigits.length >= 4) {
      // `phone` is E.164: the full number with its country code, or any tail of it, as callers read
      // out the last digits (a leading trunk zero never appears in E.164).
      const national = phoneDigits.replace(/^0+/, "");
      if (phoneDigits.length >= 6) matches.push(sql`${users.phone} = ${`+${phoneDigits}`}`);
      if (national.length >= 4) matches.push(sql`${users.phone} like ${`%${national}`}`);
    }
    if (idPrefix.length >= 4) matches.push(sql`${users.id}::text like ${`${idPrefix}%`}`);
    return this.handle.db
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(or(...matches))
      .orderBy(users.name, users.id)
      .limit(GROUP_LIMIT);
  }

  /** The `WSO-` prefix is optional: both the typed text and `WSO-<text>` are tried. */
  orders(text: string, idPrefix: string) {
    const matches: SQL[] = [
      ilike(orders.number, prefixOf(text)),
      ilike(orders.number, prefixOf(`WSO-${text}`)),
    ];
    if (idPrefix.length >= 4) matches.push(sql`${orders.id}::text like ${`${idPrefix}%`}`);
    return this.handle.db
      .select({ id: orders.id, number: orders.number, status: orders.status })
      .from(orders)
      .where(or(...matches))
      .orderBy(orders.number)
      .limit(GROUP_LIMIT);
  }

  payments(text: string, idPrefix: string) {
    const matches: SQL[] = [
      ilike(payments.reference, prefixOf(text)),
      ilike(payments.reference, prefixOf(`WSP-${text}`)),
    ];
    if (idPrefix.length >= 4) matches.push(sql`${payments.id}::text like ${`${idPrefix}%`}`);
    return this.handle.db
      .select({ id: payments.id, reference: payments.reference, status: payments.status })
      .from(payments)
      .where(or(...matches))
      .orderBy(payments.reference)
      .limit(GROUP_LIMIT);
  }

  coupons(text: string) {
    return this.handle.db
      .select({ id: coupons.id, code: coupons.code, status: coupons.status })
      .from(coupons)
      .where(ilike(coupons.code, prefixOf(text)))
      .orderBy(coupons.code)
      .limit(GROUP_LIMIT);
  }

  referralCodes(text: string) {
    return this.handle.db
      .select({ id: referralCodes.id, code: referralCodes.code })
      .from(referralCodes)
      .where(ilike(referralCodes.code, prefixOf(text)))
      .orderBy(referralCodes.code)
      .limit(GROUP_LIMIT);
  }
}
