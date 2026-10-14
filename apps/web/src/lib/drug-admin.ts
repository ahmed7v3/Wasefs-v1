import { DRUG_IMPORT_FIELDS, presetMapping } from "@wasfa/shared/drugs";

import type { DrugImportStatus, DrugSource } from "@wasfa/shared/ai";
import type { DrugImportField, DrugMatchClass } from "@wasfa/shared/drugs";
import type { ImportProgress } from "@wasfa/shared/schemas/admin-drugs";
import type { BadgeTone } from "@wasfa/ui";

/** How often a running import is re-read. */
export const IMPORT_POLL_MS = 1_500;

/** A job is still going: queued behind another, or reading and writing rows. */
export function isRunning(progress: ImportProgress | null): boolean {
  return progress !== null && (progress.phase === "queued" || progress.phase === "running");
}

/** 0-100 for the progress bar; a job that has not counted its rows yet shows 0. */
export function progressPercent(progress: ImportProgress): number {
  if (progress.phase === "done") return 100;
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.floor((progress.done / progress.total) * 100));
}

export const MATCH_TONES: Record<DrugMatchClass, BadgeTone> = {
  accept: "success",
  verify: "warning",
  unmatched: "neutral",
};

export const IMPORT_STATUS_TONES: Record<DrugImportStatus, BadgeTone> = {
  draft: "neutral",
  dry_run: "info",
  committed: "success",
  rolled_back: "warning",
  failed: "danger",
};

/** A score 0-1 as a whole percent. */
export const scorePercent = (score: number): string => String(Math.round(score * 100));

/** Fields the mapping can fill, in the order the wizard offers them. */
export const MAPPING_FIELDS: readonly DrugImportField[] = DRUG_IMPORT_FIELDS;

/** `{ column: field }` with `""` for ignored columns, the shape of the wizard's selects. */
export type MappingDraft = Record<string, DrugImportField | "">;

export function draftFrom(
  headers: readonly string[],
  mapping: Readonly<Record<string, DrugImportField>>,
): MappingDraft {
  return Object.fromEntries(headers.map((header) => [header, mapping[header] ?? ""]));
}

export function presetDraft(source: DrugSource, headers: readonly string[]): MappingDraft {
  return draftFrom(headers, presetMapping(source, headers));
}

/** The mapping to send: only the columns that go somewhere. */
export function mappingFrom(draft: MappingDraft): Record<string, DrugImportField> {
  const mapping: Record<string, DrugImportField> = {};
  for (const [header, field] of Object.entries(draft)) {
    if (field !== "") mapping[header] = field;
  }
  return mapping;
}

/** Fields claimed by more than one column: the API refuses these, the wizard says so first. */
export function duplicateFields(draft: MappingDraft): DrugImportField[] {
  const seen = new Set<DrugImportField>();
  const duplicates = new Set<DrugImportField>();
  for (const field of Object.values(draft)) {
    if (field === "") continue;
    if (seen.has(field)) duplicates.add(field);
    seen.add(field);
  }
  return [...duplicates];
}

/** True when the wizard's mapping equals the one the last dry run used. */
export function sameMapping(
  draft: MappingDraft,
  used: Readonly<Record<string, DrugImportField>>,
): boolean {
  const next = mappingFrom(draft);
  const a = Object.keys(next);
  return (
    a.length === Object.keys(used).length && a.every((header) => next[header] === used[header])
  );
}
