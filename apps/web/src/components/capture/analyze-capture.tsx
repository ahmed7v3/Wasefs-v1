"use client";

import { t } from "@wasfa/shared/i18n";
import { rxCreateResponseSchema } from "@wasfa/shared/schemas/rx";
import { CaptureSurface, useToast } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api-client";
import { extractErrorRef } from "../../lib/api-error";
import { createHandoffClient } from "../../lib/capture/handoff-client";
import { clearPendingCapture, peekPendingCapture } from "../../lib/capture/pending-capture";
import { createCaptureUploader } from "../../lib/capture/uploader";
import { errorMessage } from "../error-notice";

export interface AnalyzeCaptureProps {
  maxPages: number;
  creditsPerPage: number;
  balance: number;
}

/**
 * The /analyze capture screen: wires `CaptureSurface` to the browser pipeline, the uploads API and
 * `POST /rx`. Pressing Analyze is the only thing that spends credits.
 */
export function AnalyzeCapture({ maxPages, creditsPerPage, balance }: AnalyzeCaptureProps) {
  const router = useRouter();
  const { toast } = useToast();
  const uploader = useMemo(() => createCaptureUploader(), []);
  const handoff = useMemo(() => createHandoffClient(), []);
  // Pages the dashboard's quick capture already uploaded. Read (not consumed) in the initializer so
  // a strict-mode double render sees them; they are cleared once this screen has taken them.
  const [initialFileIds] = useState(peekPendingCapture);
  useEffect(() => {
    clearPendingCapture();
  }, []);

  async function analyze(fileIds: string[]): Promise<void> {
    try {
      const created = await api("/rx", {
        method: "POST",
        body: { fileIds, mode: "balanced" },
        schema: rxCreateResponseSchema,
      });
      router.push(`/analyze/${created.id}`);
    } catch (error) {
      const ref = extractErrorRef(error);
      toast({
        tone: "error",
        title: t("analyze.failed"),
        description: ref ? `${errorMessage(error)} (${ref})` : errorMessage(error),
      });
      // Rethrown so the Analyze button comes back and the pages stay for another try.
      throw error;
    }
  }

  return (
    <CaptureSurface
      variant="full"
      maxPages={maxPages}
      price={{ perPage: creditsPerPage, balance }}
      uploader={uploader}
      handoff={handoff}
      initialFileIds={initialFileIds}
      onPagesChange={noop}
      onAnalyze={analyze}
    />
  );
}

function noop(): void {
  // The surface owns the pages; this screen needs them only at Analyze time.
}
