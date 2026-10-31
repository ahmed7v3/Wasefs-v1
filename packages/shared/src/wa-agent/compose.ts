/*
 * The WhatsApp composer pipeline (docs/WA-AGENT-RUNTIME.md §18.6): formatting, then bidi isolation, then
 * splitting. Applied to model text and to every template so the customer sees one consistent shape.
 */
import { isolateBidi } from "./bidi.js";
import { toWhatsApp } from "./format.js";
import { splitReply, type SplitOptions } from "./split.js";

export function composeText(text: string, opts: SplitOptions): string[] {
  return splitReply(isolateBidi(toWhatsApp(text)), opts);
}
