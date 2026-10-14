"use client";

import { t } from "@wasfa/shared/i18n";
import { CaptureSurface, type CapturePage } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { createHandoffClient } from "../../lib/capture/handoff-client";
import { stashPendingCapture } from "../../lib/capture/pending-capture";
import { createCaptureUploader } from "../../lib/capture/uploader";

import { DashboardPanel } from "./dashboard-panel";

export interface QuickCaptureProps {
  /** Plan limit (`rx.maxPages`). */
  maxPages: number;
}

/** A page is done when it is on the server; a page that needs a decision or failed keeps the person here. */
function allUploaded(pages: readonly CapturePage[]): boolean {
  return pages.length > 0 && pages.every((page) => page.status === "uploaded" && page.fileId);
}

/**
 * The dashboard's capture card: a compact `CaptureSurface`. As soon as every page dropped, pasted
 * or picked here is uploaded, the file ids are handed to `/analyze` (see `pending-capture`), which
 * shows them as pages ready to analyze. Nothing is charged here: Analyze is pressed on that screen.
 */
export function QuickCapture({ maxPages }: QuickCaptureProps) {
  const router = useRouter();
  const uploader = useMemo(() => createCaptureUploader(), []);
  const handoff = useMemo(() => createHandoffClient(), []);
  const [going, setGoing] = useState(false);
  const left = useRef(false);

  const onPagesChange = useCallback(
    (pages: CapturePage[]) => {
      if (left.current || !allUploaded(pages)) return;
      const fileIds = pages.flatMap((page) => (page.fileId ? [page.fileId] : []));
      // Without storage the pages cannot travel: stay, and the person can still go to /analyze.
      if (!stashPendingCapture(fileIds)) return;
      left.current = true;
      setGoing(true);
      router.push("/analyze");
    },
    [router],
  );

  return (
    <DashboardPanel id="quick-capture-title" title={t("dashboard.capture.title")}>
      <p className="text-base text-text-muted">{t("dashboard.capture.lead")}</p>
      <CaptureSurface
        variant="compact"
        maxPages={maxPages}
        uploader={uploader}
        handoff={handoff}
        disabled={going}
        onPagesChange={onPagesChange}
      />
      {going ? (
        <p role="status" className="text-sm font-semibold text-primary">
          {t("dashboard.capture.going")}
        </p>
      ) : null}
    </DashboardPanel>
  );
}
