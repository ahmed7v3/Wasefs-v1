import { t, type Locale } from "@wasfa/shared/i18n";
import { z } from "zod";

import { READ_ONLY_TOOLS } from "../turn/agent-round.js";

import type { ToolCallRecord } from "./tools/index.js";

/*
 * Tool memory (docs/WA-AGENT-RUNTIME.md §8.3, §18.5): after a v2 turn a compact note per effectful tool
 * call rests on the reply row (`meta.toolNotes`) and is shown to the model in later turns, so it knows
 * what already happened (an analysis started, a refusal) without seeing the raw results again.
 * Codes, short references and handles only: never customer text.
 */

export const toolNoteSchema = z.object({
  tool: z.string().max(64),
  /** `ok`, or the refusal / failure code. */
  outcome: z.string().max(64),
  /** First characters of the analysis id (display only). */
  rxRef: z.string().max(12).optional(),
  /** Attachment handles the call used, as `#3`. */
  handles: z.array(z.string().max(12)).max(20).optional(),
});
export type ToolNote = z.infer<typeof toolNoteSchema>;

const toolNotesSchema = z.array(toolNoteSchema).max(20);

/** The notes of a turn's tool calls; read-only tools leave none (they changed nothing). */
export function toolNotesOf(records: readonly ToolCallRecord[]): ToolNote[] {
  return records
    .filter((record) => !READ_ONLY_TOOLS.has(record.name))
    .slice(0, 20)
    .map((record) => ({
      tool: record.name,
      outcome: record.ok ? (record.refusal ?? "ok") : (record.code ?? "error"),
      ...(record.rxRef === undefined ? {} : { rxRef: record.rxRef }),
      ...(record.handles === undefined || record.handles.length === 0
        ? {}
        : { handles: record.handles }),
    }));
}

/** The notes stored on a row; anything that does not parse is ignored (the row is only history). */
export function parseToolNotes(raw: unknown): ToolNote[] {
  const parsed = toolNotesSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** `[أداة: analyze_prescription → started rx#a1b2c3 (#3 #4)]`; a refusal shows its code instead of "started". */
export function toolNoteLine(note: ToolNote, locale: Locale): string {
  const outcome = note.outcome === "ok" && note.rxRef !== undefined ? "started" : note.outcome;
  const ref = note.rxRef === undefined ? "" : ` rx#${note.rxRef}`;
  const handles =
    note.handles === undefined || note.handles.length === 0 ? "" : ` (${note.handles.join(" ")})`;
  return t(
    "whatsapp.agent.toolNote",
    { body: `${note.tool} → ${outcome}${ref}${handles}` },
    locale,
  );
}
