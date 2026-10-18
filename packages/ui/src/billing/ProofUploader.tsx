"use client";

import { t } from "@wasfa/shared/i18n";
import { useCallback, useRef } from "react";

import {
  CaptureSurface,
  type CapturePage,
  type CaptureUploader,
  type HandoffClient,
} from "../capture";
import { cn } from "../cn";

export interface ProofUploaderProps {
  /** Browser-side processing and transport for `payment_proof` files, injected by `apps/web`. */
  uploader: CaptureUploader;
  handoff?: HandoffClient | undefined;
  /** The file id once the screenshot is on the server and processed; `null` while there is none. */
  onChange: (fileId: string | null) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The picture of the transfer: the Phase 2 capture surface (drop, paste, pick, camera, phone) with
 * room for exactly one page. It owns no transport; the form that wraps it decides when to send.
 */
export function ProofUploader({
  uploader,
  handoff,
  onChange,
  disabled = false,
  className,
}: ProofUploaderProps) {
  const last = useRef<string | null>(null);
  const handlePages = useCallback(
    (pages: CapturePage[]) => {
      const ready = pages.find((page) => page.status === "uploaded" && page.fileId);
      const fileId = ready?.fileId ?? null;
      if (fileId === last.current) return;
      last.current = fileId;
      onChange(fileId);
    },
    [onChange],
  );
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-base text-text-muted">{t("billing.proof.hint")}</p>
      <CaptureSurface
        variant="compact"
        maxPages={1}
        uploader={uploader}
        handoff={handoff}
        disabled={disabled}
        onPagesChange={handlePages}
      />
    </div>
  );
}
