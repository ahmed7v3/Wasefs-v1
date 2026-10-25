"use client";

import { t } from "@wasfa/shared/i18n";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { autosaveLabel } from "../../../lib/content-editor/autosave-label";

import type { AutosaveStatus } from "../../../lib/content-editor/autosave";

export interface AutosaveIndicatorProps {
  status: AutosaveStatus;
  dirty: boolean;
}

/**
 * «تم الحفظ قبل N ثوانٍ» / «جارٍ الحفظ…» / «تعذّر الحفظ — محفوظ على جهازك». The visible text ticks every
 * few seconds; screen readers get a separate region that changes ONLY when the state changes, so the
 * ticking never chatters (`aria-live="polite"`).
 */
export function AutosaveIndicator({ status, dirty }: AutosaveIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 5_000);
    return () => {
      clearInterval(timer);
    };
  }, [status]);

  const label = autosaveLabel(status, dirty, now);
  const Icon =
    status.kind === "saving" ? LoaderCircle : status.kind === "error" ? CircleAlert : CircleCheck;
  const stateText =
    status.kind === "saving"
      ? t("admin.editor.autosave.saving")
      : status.kind === "error"
        ? t("admin.editor.autosave.failed")
        : status.kind === "saved"
          ? t("admin.editor.autosave.savedState")
          : "";

  return (
    <>
      <span
        aria-hidden
        data-testid="autosave"
        className={`inline-flex items-center gap-1 text-sm ${status.kind === "error" ? "text-danger" : "text-text-muted"}`}
      >
        {label ? (
          <>
            <Icon className={`size-4 ${status.kind === "saving" ? "animate-spin" : ""}`} />
            {label}
          </>
        ) : null}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {stateText}
      </span>
    </>
  );
}
