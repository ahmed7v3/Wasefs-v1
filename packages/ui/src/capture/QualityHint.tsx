import { t } from "@wasfa/shared/i18n";
import { Lightbulb } from "lucide-react";

import { Button } from "../button";

import type { QualityIssue } from "./types";

/** The most useful hint first: a blurry photo is the commonest and the hardest to fix later. */
const PRIORITY: readonly QualityIssue[] = ["blurry", "dark", "bright", "low_res"];

const TITLES = {
  blurry: "capture.quality.title.blurry",
  dark: "capture.quality.title.dark",
  bright: "capture.quality.title.bright",
  low_res: "capture.quality.title.low_res",
} as const;

const ISSUES = {
  blurry: "capture.quality.issue.blurry",
  dark: "capture.quality.issue.dark",
  bright: "capture.quality.issue.bright",
  low_res: "capture.quality.issue.low_res",
} as const;

/** Comma-joined names of the issues, for the live region. */
export function describeIssues(issues: readonly QualityIssue[]): string {
  return issues.map((issue) => t(ISSUES[issue])).join("، ");
}

export interface QualityHintProps {
  /** 1-based position of the page. */
  n: number;
  issues: readonly QualityIssue[];
  previewUrl: string;
  onRetake: () => void;
  onContinue: () => void;
}

/**
 * Gentle hint card (never a blocker): the photo is kept in the browser until the person chooses
 * "continue anyway", and a retake removes it. No credits are spent before Analyze.
 */
export function QualityHint({ n, issues, previewUrl, onRetake, onContinue }: QualityHintProps) {
  const main = PRIORITY.find((issue) => issues.includes(issue));
  if (!main) return null;
  const others = issues.filter((issue) => issue !== main);
  return (
    <div
      role="group"
      aria-label={t("capture.quality.preview", { n })}
      data-testid="quality-hint"
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 sm:flex-row sm:items-center"
    >
      {previewUrl ? (
        // A local object URL: next/image does not apply and the size is fixed by the class.
        <img
          src={previewUrl}
          alt=""
          className="h-24 w-20 shrink-0 rounded-md border border-border bg-surface object-cover"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-start gap-2 text-base font-semibold text-text">
          <Lightbulb aria-hidden className="mt-1 size-5 shrink-0 text-warning" />
          <span>{t(TITLES[main])}</span>
        </p>
        {others.length > 0 ? (
          <p className="text-sm text-text-muted">{describeIssues(others)}</p>
        ) : null}
        <p className="text-sm text-text-muted">{t("capture.quality.free")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onRetake}>
          {t("capture.quality.retake")}
        </Button>
        <Button variant="secondary" onClick={onContinue}>
          {t("capture.quality.continue")}
        </Button>
      </div>
    </div>
  );
}
