import { t } from "@wasfa/shared/i18n";
import { CircleAlert, CircleHelp, ShieldCheck, TriangleAlert } from "lucide-react";

import { Badge, type BadgeTone } from "./badge";

export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * The level that may be shown. A name that was not matched to a drug can never be `high`, whatever
 * the stored value says (phase2.md Decision 8): the contract rejects it, and this is the second lock.
 */
export function shownConfidence(level: ConfidenceLevel, unmatched: boolean): ConfidenceLevel {
  return unmatched && level === "high" ? "medium" : level;
}

const tones: Record<ConfidenceLevel, BadgeTone> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

const icons = {
  high: ShieldCheck,
  medium: CircleAlert,
  low: TriangleAlert,
} as const;

export interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  /** The drug name was not matched to a drug: "غير مؤكد" is shown instead of the level's words. */
  unmatched?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Confidence of one prescription line: an icon and words, never colour alone. For an unmatched
 * name the words are "غير مؤكد" and the level stays available to screen readers.
 */
export function ConfidenceBadge({ level, unmatched = false, className }: ConfidenceBadgeProps) {
  const shown = shownConfidence(level, unmatched);
  const Icon = unmatched ? CircleHelp : icons[shown];
  const levelText = t(`rx.badge.${shown}`);
  return (
    <Badge tone={tones[shown]} className={className} data-confidence={shown}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {unmatched ? (
        <>
          {t("rx.unmatched")}
          <span className="sr-only">{`، ${levelText}`}</span>
        </>
      ) : (
        levelText
      )}
    </Badge>
  );
}
