import { WA_PRIVACY_CONFIRM, type WaCommand } from "@wasfa/shared/i18n/wa-commands";
import { matchCommand, type MatchOptions } from "@wasfa/shared/wa-agent/commands";
import { normalizeCommandText } from "@wasfa/shared/wa-agent/normalize";
import { isActive, type WaSessionState } from "@wasfa/shared/wa-agent/session";

import type { CommandVia } from "./command-types.js";

/** What the router reads of an inbound row (a `TurnMessage` or a freshly ingested entry fits). */
export interface IntentRow {
  kind: string;
  text: string | null | undefined;
  mediaKey?: string | null | undefined;
}

/** What a row is to the command layer. */
export type RowIntent =
  | { type: "command"; command: WaCommand; via: Exclude<CommandVia, "awaiting">; arg?: string }
  | { type: "image" }
  | { type: "other" };

/** The running state a row is read against (it changes as earlier rows of the same turn are answered). */
export interface IntentState {
  menuActive: boolean;
  privacyActive: boolean;
}

export const stateOf = (state: WaSessionState, now: Date): IntentState => ({
  menuActive: isActive(state.menu, now),
  privacyActive: isActive(state.privacyConfirm, now),
});

const CONFIRM_WORDS = new Set(WA_PRIVACY_CONFIRM.map((word) => normalizeCommandText(word)));

const hasText = (row: IntentRow): row is IntentRow & { text: string } =>
  typeof row.text === "string" && row.text.trim() !== "";

/**
 * Pure: whether one row is a command (docs/WA-AGENT-RUNTIME.md §7.1). Text rows are matched whole-message;
 * an image or PDF counts only through its caption and only as `analyze`; the privacy confirm word counts
 * only while a confirmation is open. A picture without a caption is `image` (it may belong to `analyze`).
 */
export function intentOf(
  row: IntentRow,
  state: IntentState,
  aliases: MatchOptions["aliases"],
): RowIntent {
  const isMedia = row.kind === "image" || row.kind === "document";
  if (row.kind !== "text" && !isMedia) return { type: "other" };
  if (hasText(row)) {
    if (!isMedia && state.privacyActive && CONFIRM_WORDS.has(normalizeCommandText(row.text))) {
      return { type: "command", command: "privacy", via: "alias", arg: "confirm" };
    }
    const match = matchCommand(row.text, {
      ...(aliases === undefined ? {} : { aliases }),
      isCaption: isMedia,
      menuActive: state.menuActive,
    });
    if (match !== null) {
      return {
        type: "command",
        command: match.command,
        via: match.via,
        ...(match.arg === undefined ? {} : { arg: match.arg }),
      };
    }
    return { type: "other" };
  }
  return row.kind === "image" && typeof row.mediaKey === "string"
    ? { type: "image" }
    : { type: "other" };
}
