import { composeText } from "@wasfa/shared/wa-agent/compose";

import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";

export interface ComposeCaps {
  maxReplyChars: number;
  maxMessagesPerTurn: number;
}

/**
 * Every v2 customer text goes through here (docs/WA-AGENT-RUNTIME.md section 11): WhatsApp formatting,
 * bidi isolation, then the split to the admin's caps. Empty text gives no parts.
 */
export function composeParts(text: string, caps: ComposeCaps): WaAgentOutboundPart[] {
  return composeText(text, { maxChars: caps.maxReplyChars, maxParts: caps.maxMessagesPerTurn }).map(
    (part): WaAgentOutboundPart => ({ kind: "text", text: part }),
  );
}

/** Each text part goes through the composer; documents, images and voice notes pass as they are. */
export function composeTextParts(
  parts: readonly WaAgentOutboundPart[],
  caps: ComposeCaps,
): WaAgentOutboundPart[] {
  return parts.flatMap((part) => (part.kind === "text" ? composeParts(part.text, caps) : [part]));
}
