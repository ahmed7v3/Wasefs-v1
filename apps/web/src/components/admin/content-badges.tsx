import { t } from "@wasfa/shared/i18n";
import { Badge, type BadgeTone } from "@wasfa/ui";
import { CircleAlert, CircleDot, Globe, TriangleAlert } from "lucide-react";

import type { ContentLocale, ContentStatus } from "@wasfa/shared/content/constants";

/*
 * Small status vocabulary of the content screens. Every chip has a word (colour is never the only
 * signal): the status name, «منشور» for an item the public can see, and the issue counts.
 */

export const CONTENT_STATUS_TONE: Record<ContentStatus, BadgeTone> = {
  draft: "neutral",
  in_review: "warning",
  approved: "info",
  scheduled: "info",
  published: "success",
  archived: "neutral",
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return <Badge tone={CONTENT_STATUS_TONE[status]}>{t(`admin.content.status.${status}`)}</Badge>;
}

/** The item is live: the public sees (a version of) it, whatever the working copy's status is. */
export function LiveBadge() {
  return (
    <Badge tone="success">
      <Globe aria-hidden className="size-4" />
      {t("admin.content.live")}
    </Badge>
  );
}

export function LocaleChip({ locale }: { locale: ContentLocale }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-neutral-100 px-1.5 text-xs font-semibold text-neutral-700">
      {t(`admin.content.locale.${locale}`)}
    </span>
  );
}

/** Failing gates of the working revision: blocking ones in red, warnings in amber. */
export function IssueBadges({ issues }: { issues: { block: number; warn: number } }) {
  if (issues.block === 0 && issues.warn === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-text-muted">
        <CircleDot aria-hidden className="size-4" />
        {t("admin.content.issues.none")}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {issues.block > 0 ? (
        <Badge tone="danger">
          <CircleAlert aria-hidden className="size-4" />
          {t("admin.content.issues.block", { count: issues.block })}
        </Badge>
      ) : null}
      {issues.warn > 0 ? (
        <Badge tone="warning">
          <TriangleAlert aria-hidden className="size-4" />
          {t("admin.content.issues.warn", { count: issues.warn })}
        </Badge>
      ) : null}
    </span>
  );
}
