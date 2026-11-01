import { intentOf, type IntentRow, type IntentState } from "./command-intent.js";

import type { CommandStep } from "./command-types.js";
import type { WaCommand } from "@wasfa/shared/i18n/wa-commands";
import type { MatchOptions } from "@wasfa/shared/wa-agent/commands";

export interface PlanRow extends IntentRow {
  id: string;
  createdAt: Date;
}

export interface PlanOptions {
  state: IntentState;
  /** `awaitingRx` is open: the next pictures are analysed without being asked. */
  awaitingRx: boolean;
  aliases: MatchOptions["aliases"];
  /** Steps one turn answers (its replies must fit the admin's message cap). */
  maxSteps: number;
  /** Counts the command in the rate-limit windows; false = over the limit, the row is normal text. */
  allow: (command: WaCommand, confirming: boolean) => Promise<boolean>;
}

/**
 * Splits the unanswered rows (oldest first) into the steps the command layer answers and leaves the rest
 * to the model (docs/WA-AGENT-RUNTIME.md §7.1, §18.4). Only a contiguous prefix is taken: the first row
 * that is not a command ends it, so «text, then a command» goes to the model whole. Two things extend the
 * prefix beyond single command rows: pictures right before an `analyze` command (or its caption) belong to
 * that step, and with `awaitingRx` open a run of plain pictures is itself an `analyze` step.
 * Pure but for `allow`, which counts.
 */
export async function planSteps(
  rows: readonly PlanRow[],
  options: PlanOptions,
): Promise<CommandStep[]> {
  const flags: IntentState = { ...options.state };
  let awaiting = options.awaitingRx;
  const steps: CommandStep[] = [];
  const intent = (row: PlanRow) => intentOf(row, flags, options.aliases);
  let index = 0;
  while (index < rows.length && steps.length < options.maxSteps) {
    const row = rows[index];
    if (row === undefined) break;
    const here = intent(row);
    if (here.type === "command") {
      if (!(await options.allow(here.command, here.arg === "confirm"))) break;
      steps.push(stepOf(here, [row], row));
      if (here.command === "help") flags.menuActive = true;
      else if (here.via === "menu") flags.menuActive = false;
      if (here.command === "privacy") flags.privacyActive = here.arg !== "confirm";
      index += 1;
      continue;
    }
    if (here.type !== "image") break;
    let end = index;
    while (
      end < rows.length &&
      rows[end] !== undefined &&
      intent(rows[end] as PlanRow).type === "image"
    ) {
      end += 1;
    }
    const pictures = rows.slice(index, end);
    const next = rows[end];
    const after = next === undefined ? null : intent(next);
    if (next !== undefined && after?.type === "command" && after.command === "analyze") {
      if (!(await options.allow("analyze", false))) break;
      steps.push(stepOf(after, [...pictures, next], next));
      index = end + 1;
      continue;
    }
    if (!awaiting) break;
    awaiting = false;
    steps.push({
      command: "analyze",
      via: "awaiting",
      rowIds: pictures.map((picture) => picture.id),
      at: pictures[pictures.length - 1]?.createdAt ?? row.createdAt,
    });
    index = end;
  }
  return steps;
}

function stepOf(
  intent: Extract<ReturnType<typeof intentOf>, { type: "command" }>,
  rows: readonly PlanRow[],
  last: PlanRow,
): CommandStep {
  return {
    command: intent.command,
    via: intent.via,
    ...(intent.arg === undefined ? {} : { arg: intent.arg }),
    rowIds: rows.map((row) => row.id),
    at: last.createdAt,
  };
}
