"use client";

import { t } from "@wasfa/shared/i18n";
import { HANDOFF_MAX_FILES } from "@wasfa/shared/schemas/handoff";
import { CaptureSurface, type CapturePage } from "@wasfa/ui";
import { CircleCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { handoffTransport } from "../../lib/capture/transports";
import { createCaptureUploader } from "../../lib/capture/uploader";

export interface PhoneCaptureProps {
  token: string;
  /** Pages this link can still take. */
  remaining: number;
}

/**
 * The phone side of the handoff: the same capture surface (camera, quality hints, tray), with the
 * token's upload routes and no Analyze bar. Analysis can only be started on the desktop.
 */
export function PhoneCapture({ token, remaining }: PhoneCaptureProps) {
  const uploader = useMemo(() => createCaptureUploader(handoffTransport(token)), [token]);
  const [sent, setSent] = useState(0);

  function onPagesChange(pages: CapturePage[]): void {
    setSent(pages.filter((page) => page.status === "uploaded").length);
  }

  const total = HANDOFF_MAX_FILES - remaining + sent;
  const done = sent >= remaining && remaining > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-text-muted tabular-nums" aria-live="polite">
        {done
          ? t("capture.phonePage.done")
          : sent > 0
            ? t("capture.phonePage.sent", { count: total, max: HANDOFF_MAX_FILES })
            : t("capture.phonePage.remaining", { count: remaining })}
      </p>
      {done ? <CircleCheck aria-hidden className="size-8 text-success" /> : null}
      <CaptureSurface
        variant="compact"
        maxPages={Math.max(1, remaining)}
        uploader={uploader}
        disabled={remaining === 0}
        onPagesChange={onPagesChange}
      />
    </div>
  );
}
