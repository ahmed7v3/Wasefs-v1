import { t, type Locale } from "@wasfa/shared/i18n";

import { composeParts } from "../compose/compose-parts.js";

import type { ToolOutput } from "./tools/index.js";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/** "page / two pages / N pages": Arabic has a dual form, so the label has three keys instead of a plural rule. */
function pagesLabel(pages: number, locale: Locale): string {
  const key = pages === 1 ? "one" : pages === 2 ? "two" : "many";
  return t(`whatsapp.agent.rx.pages.${key}`, { count: String(pages) }, locale);
}

/**
 * The one short line sent when a v2 `analyze_prescription` call started the reading (docs/WA-AGENT-RUNTIME.md
 * section 12 step 3); null when no call did. Deterministic: the model never words it.
 */
export function rxStartLine(outputs: readonly ToolOutput[], locale: Locale): string | null {
  const started = startedOutput(outputs);
  if (started === null) return null;
  const pages = typeof started.pages === "number" && started.pages >= 1 ? started.pages : 1;
  return rxStartText(pages, locale);
}

/** The start line for `pages` pages; the command layer sends it too, so both read the same. */
export function rxStartText(pages: number, locale: Locale): string {
  return t("whatsapp.agent.rx.starting", { pages: pagesLabel(pages, locale) }, locale);
}

/** True when a reading started this round: the reply then stays text so the start line is not lost. */
export const rxStarted = (outputs: readonly ToolOutput[]): boolean =>
  startedOutput(outputs) !== null;

function startedOutput(outputs: readonly ToolOutput[]): { pages?: unknown } | null {
  for (const output of outputs) {
    if (output.name !== "analyze_prescription") continue;
    const result = output.result as { started?: unknown; pages?: unknown } | null;
    if (result?.started === true) return result;
  }
  return null;
}

/**
 * The v2 reply: media first, the rx start line (when a reading started) as the first text, then the model's
 * words composed into what is left of the message budget. A start line with no model text is a whole reply.
 */
export function composedReplyParts(
  text: string,
  media: readonly WaAgentOutboundPart[],
  outputs: readonly ToolOutput[],
  config: WaAgentSettings,
): WaAgentOutboundPart[] {
  const { caps } = config;
  const line = rxStartLine(outputs, config.language === "en" ? "en" : "ar");
  const head = line === null ? [] : composeParts(line, caps).slice(0, 1);
  const budget = caps.maxMessagesPerTurn - media.length - head.length;
  return [...media, ...head, ...composeParts(text, { ...caps, maxMessagesPerTurn: budget })];
}
