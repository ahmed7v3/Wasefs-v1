"use client";

import { t } from "@wasfa/shared/i18n";
import { Card, CopyField, buttonStyles } from "@wasfa/ui";
import { MessageCircle, Send } from "lucide-react";

import {
  heroSummary,
  shareMessage,
  telegramShareUrl,
  whatsappShareUrl,
} from "../../lib/rewards-text";

import { VanityDialog } from "./vanity-dialog";

import type { MeRewards } from "@wasfa/shared/schemas/rewards";

export interface InviteHeroProps {
  rewards: MeRewards;
  onRenamed: () => void;
}

/**
 * Block 1 of REFERRALS §10: the code and link with copy and share buttons, and what each side gets
 * in one line. Sharing opens WhatsApp or Telegram with a ready message; nothing is posted for the person.
 */
export function InviteHero({ rewards, onRenamed }: InviteHeroProps) {
  const summary = heroSummary(rewards.offers);
  const text = shareMessage(rewards.link);
  const shareStyles = buttonStyles({ variant: "secondary" });

  return (
    <Card elevation="raised" className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 className="font-heading text-2xl font-bold text-primary">
          {t("rewardsPage.hero.title")}
        </h2>
        {summary.you || summary.friend ? (
          <p className="text-base text-text sm:text-lg" data-testid="hero-summary">
            {summary.you ? (
              <>
                <strong className="font-semibold">{t("rewardsPage.hero.you")}</strong> {summary.you}
              </>
            ) : null}
            {summary.you && summary.friend ? " · " : null}
            {summary.friend ? (
              <>
                <strong className="font-semibold">{t("rewardsPage.hero.friend")}</strong>{" "}
                {summary.friend}
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-base text-text-muted">{t("rewardsPage.hero.noOffers")}</p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <CopyField label={t("rewardsPage.hero.code")} value={rewards.code} />
        <CopyField label={t("rewardsPage.hero.link")} value={rewards.link} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={whatsappShareUrl(text)}
          target="_blank"
          rel="noopener noreferrer"
          className={shareStyles}
        >
          <MessageCircle aria-hidden className="size-4" />
          {t("rewardsPage.share.whatsapp")}
        </a>
        <a
          href={telegramShareUrl(rewards.link, text)}
          target="_blank"
          rel="noopener noreferrer"
          className={shareStyles}
        >
          <Send aria-hidden className="size-4 rtl:-scale-x-100" />
          {t("rewardsPage.share.telegram")}
        </a>
        <VanityDialog code={rewards.code} edited={rewards.vanityEdited} onRenamed={onRenamed} />
      </div>
    </Card>
  );
}
