import { t } from "@wasfa/shared/i18n";
import { Badge, type BadgeTone } from "@wasfa/ui";
import { CircleDot, Globe, PencilLine } from "lucide-react";

import type { ContentStatus } from "@wasfa/shared/content/constants";

const TONE: Record<ContentStatus, BadgeTone> = {
  draft: "neutral",
  in_review: "warning",
  approved: "info",
  scheduled: "info",
  published: "success",
  archived: "neutral",
};

/** The working copy's status, as a word (colour is never the only signal). */
export function EditorStatusBadge({ status }: { status: ContentStatus }) {
  return (
    <Badge tone={TONE[status]} data-testid="status-chip">
      {t(`admin.editor.status.${status}`)}
    </Badge>
  );
}

/** The public can see (a version of) this item. */
export function EditorLiveBadge() {
  return (
    <Badge tone="success">
      <Globe aria-hidden className="size-4" />
      {t("admin.editor.badge.live")}
    </Badge>
  );
}

/** The working copy differs from the live one: saving does not change the public page until republished. */
export function UnpublishedChangesBadge() {
  return (
    <Badge tone="warning">
      <PencilLine aria-hidden className="size-4" />
      {t("admin.editor.badge.unpublished")}
    </Badge>
  );
}

export function UnsavedBadge() {
  return (
    <Badge tone="neutral">
      <CircleDot aria-hidden className="size-4" />
      {t("admin.editor.badge.unsaved")}
    </Badge>
  );
}
