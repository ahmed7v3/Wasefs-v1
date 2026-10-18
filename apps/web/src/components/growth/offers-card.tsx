"use client";

import { t } from "@wasfa/shared/i18n";
import { personalOffersResponseSchema, type PersonalOfferView } from "@wasfa/shared/schemas/growth";
import { Countdown, buttonStyles, moneyText } from "@wasfa/ui";
import { Gift } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { formatDateTime } from "../../lib/dates";
import { trackGrowth } from "../../lib/growth-events";
import { useResource } from "../../lib/use-admin-data";

function discountText(offer: PersonalOfferView): string {
  const { kind, value, currency } = offer.discount;
  if (kind === "percent") return t("growth.offer.percent", { percent: String(Math.round(value / 100)) });
  if (kind === "fixed" && currency) return moneyText(value, currency);
  return offer.titleAr;
}

/**
 * The person's open personal offers (GROWTH §6). The deadline is the server's `expiresAt`, shown as
 * a date and as a countdown that is the same in every tab and device; nothing is computed here.
 */
export function OffersCard() {
  const offers = useResource("/me/offers", personalOffersResponseSchema);
  const reported = useRef(new Set<string>());

  const items = useMemo(() => (offers.status === "ready" ? offers.data.offers : []), [offers]);
  useEffect(() => {
    for (const offer of items) {
      if (reported.current.has(offer.id)) continue;
      reported.current.add(offer.id);
      trackGrowth("offer_shown", { offer: offer.id, kind: offer.kind });
    }
  }, [items]);

  if (items.length === 0) return null;
  return (
    <section aria-labelledby="offers-title" className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent-soft p-4">
      <h2 id="offers-title" className="flex items-center gap-2 font-heading text-lg font-semibold text-text">
        <Gift aria-hidden className="size-5 text-primary" />
        {t("growth.offer.title")}
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((offer) => (
          <li key={offer.id} className="flex flex-wrap items-center justify-between gap-3" data-testid="personal-offer">
            <span className="flex flex-col gap-1">
              <span className="font-semibold text-text">{offer.titleAr}</span>
              <span className="text-base text-text">{discountText(offer)}</span>
              <span className="text-sm text-text-muted" data-testid="offer-deadline" data-expires-at={offer.expiresAt}>
                {t("growth.offer.endsAt", { date: formatDateTime(offer.expiresAt) })}
              </span>
              <Countdown endsAt={offer.expiresAt} />
            </span>
            <Link href="/pricing" className={buttonStyles({ variant: "secondary" })}>
              {t("growth.cta.pricing")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
