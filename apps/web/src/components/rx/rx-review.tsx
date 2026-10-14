"use client";

import { rxCandidatesResponseSchema } from "@wasfa/shared/schemas/rx";
import { CandidatePicker, type PickedCorrection, type PickerCandidate } from "@wasfa/ui";

import { useResource } from "../../lib/use-admin-data";

export interface RxReviewProps {
  analysisId: string;
  /** The line under review; `null` keeps the dialog closed. */
  index: number | null;
  rawText: string;
  onClose: () => void;
  /** The person chose: `candidates` is what was on offer, so the caller can name the pick. */
  onCorrect: (
    index: number,
    correction: PickedCorrection,
    candidates: readonly PickerCandidate[],
  ) => void;
}

/** The candidate dialog of one line, fed by `GET /rx/:id/candidates/:itemIndex`. */
export function RxReview({ analysisId, index, rawText, onClose, onCorrect }: RxReviewProps) {
  const resource = useResource(
    index === null ? null : `/rx/${analysisId}/candidates/${String(index)}`,
    rxCandidatesResponseSchema,
  );

  const candidates: PickerCandidate[] | null =
    resource.status !== "ready"
      ? null
      : resource.data.candidates.map((candidate) => ({
          id: candidate.drugId,
          name: candidate.brandEn,
          alternateName: candidate.brandAr,
          strength: candidate.strengthText,
          form: candidate.form,
          manufacturer: candidate.manufacturer,
          withdrawn: candidate.status === "withdrawn",
        }));

  return (
    <CandidatePicker
      open={index !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      rawText={rawText}
      candidates={candidates}
      loadFailed={resource.status === "error"}
      onRetry={resource.reload}
      onCorrect={(correction) => {
        if (index !== null) onCorrect(index, correction, candidates ?? []);
      }}
    />
  );
}
