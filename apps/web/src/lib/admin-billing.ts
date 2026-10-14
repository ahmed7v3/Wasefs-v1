import { type AiMode, type AiTask } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import { microsToUsd } from "@wasfa/shared/money";

/*
 * Shared helpers of the AI routes, plans and credits pages (Task 2.5). Money here is display only:
 * prices are integer USD micros per 1M tokens and are written out with the exact decimal helper.
 */

/** Tasks that read a prescription image: only they take a media resolution and a page limit. */
const RX_TASKS: ReadonlySet<AiTask> = new Set<AiTask>(["rx_extract", "rx_verify"]);

export function isRxTask(task: AiTask): boolean {
  return RX_TASKS.has(task);
}

export function taskLabel(task: AiTask): string {
  return t(`admin.ai.task.${task}`);
}

export function modeLabel(mode: AiMode): string {
  return t(`admin.ai.mode.${mode}`);
}

/** `$0.75 / $3.75` (input / output, per 1M tokens). */
export function formatPricePair(inputMicros: number, outputMicros: number): string {
  return `$${microsToUsd(inputMicros)} / $${microsToUsd(outputMicros)}`;
}

/** The wallet owner kinds, in the admin's words. */
export function ownerTypeLabel(type: "user" | "org"): string {
  return t(type === "user" ? "admin.credits.owner.user" : "admin.credits.owner.org");
}

/** True while a plan assignment still applies (no end, or an end in the future). */
export function isAssignmentActive(endsAt: string | null, now: number = Date.now()): boolean {
  return endsAt === null || Date.parse(endsAt) > now;
}
