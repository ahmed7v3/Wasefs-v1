import { t, type Locale } from "@wasfa/shared/i18n";

import type { ToolOutput } from "../agent/tools/index.js";

/*
 * What the customer is told when the model failed after tools already ran (docs/WA-AGENT-RUNTIME.md
 * section 5.4): fixed texts built from what the tools returned, so an effect is never left unannounced.
 * Only the tools whose outcome the customer must hear about have a text.
 */

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function textFor(output: ToolOutput, locale: Locale): string | null {
  const result = record(output.result);
  switch (output.name) {
    case "analyze_prescription":
      return result["started"] === true
        ? t("whatsapp.agent.fallback.analyze_prescription", {}, locale)
        : null;
    case "start_subscription": {
      if (result["started"] !== true) return null;
      const orderRef = str(result["orderRef"]);
      const instructions = record(result["instructions"]);
      if (result["free"] === true || Object.keys(instructions).length === 0) {
        return t("whatsapp.agent.fallback.start_subscription.free", { orderRef }, locale);
      }
      return t(
        "whatsapp.agent.fallback.start_subscription",
        {
          orderRef,
          amount: str(result["formatted"]),
          bank: str(instructions["bankName"]),
          holder: str(instructions["accountName"]),
          account: str(instructions["account"]),
          reference: str(instructions["reference"]),
        },
        locale,
      );
    }
    case "offer_discount":
      return result["offered"] === true
        ? t(
            "whatsapp.agent.fallback.offer_discount",
            { code: str(result["code"]), expires: str(result["expiresAtCairo"]) },
            locale,
          )
        : null;
    case "create_document":
      return result["creating"] === true
        ? t("whatsapp.agent.fallback.create_document", {}, locale)
        : null;
    case "handoff_to_owner":
      return result["handedOff"] === true
        ? t("whatsapp.agent.fallback.handoff_to_owner", {}, locale)
        : null;
    default:
      return null;
  }
}

/** One text per effect that happened, in the order the tools ran; empty when none has a text. */
export function fallbackTexts(outputs: readonly ToolOutput[], locale: Locale): string[] {
  return outputs.flatMap((output) => {
    const text = textFor(output, locale);
    return text === null ? [] : [text];
  });
}
