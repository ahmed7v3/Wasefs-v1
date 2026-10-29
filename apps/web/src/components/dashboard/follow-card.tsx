"use client";

import { t } from "@wasfa/shared/i18n";
import { rxListResponseSchema } from "@wasfa/shared/schemas/rx";
import { Button, buttonStyles } from "@wasfa/ui";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";

import { DashboardPanel } from "./dashboard-panel";
import { RECENT_COUNT } from "./recent-layout";

/** Dismissed in this browser only: it is a nudge, not a record. */
export const FOLLOW_DISMISSED_KEY = "wasfa.followCardDismissed";

export interface FollowCardProps {
  /** The page to follow (public `socials.facebook`); without one there is nothing to offer. */
  facebookUrl: string | null;
  /** `me.onboarding.followed`: they already did. */
  followed: boolean;
}

/**
 * The social follow ask, moved out of onboarding (docs/WA-SIGNUP.md section 4): shown once the
 * first prescription analysis has succeeded, until followed or dismissed. Shares its request with
 * the recent-analyses card, so it costs no extra call.
 */
export function FollowCard({ facebookUrl, followed }: FollowCardProps) {
  const list = useResource(`/rx?limit=${String(RECENT_COUNT)}`, rxListResponseSchema);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(FOLLOW_DISMISSED_KEY) === "1");
  }, []);

  if (followed || dismissed || facebookUrl === null) return null;
  if (list.status !== "ready" || !list.data.items.some((item) => item.status === "done")) {
    return null;
  }

  const dismiss = () => {
    window.localStorage.setItem(FOLLOW_DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <DashboardPanel id="follow-title" title={t("dashboard.follow.title")}>
      <p className="text-base text-text-muted">{t("dashboard.follow.body")}</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" name="dismiss-follow" onClick={dismiss}>
          {t("dashboard.follow.dismiss")}
        </Button>
        <a
          href={facebookUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonStyles()}
          onClick={() => {
            // Recorded on the account; the card goes away either way.
            void api("/onboarding/followed", { method: "PUT" }).catch(() => undefined);
            dismiss();
          }}
        >
          <ExternalLink aria-hidden className="size-5" />
          {t("dashboard.follow.action")}
        </a>
      </div>
    </DashboardPanel>
  );
}
