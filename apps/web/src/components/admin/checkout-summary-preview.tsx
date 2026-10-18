import { CheckoutSummary } from "@wasfa/ui";

import { summaryFromQuote } from "../../lib/checkout-summary";

import type { QuoteResponse } from "@wasfa/shared/schemas/billing";

/**
 * The checkout summary as a customer would see it for a quote the engine produced (simulator) or
 * for the current fee and tax rules. Same component and same quote shaping as the checkout page,
 * so what the admin previews is what customers get.
 */
export function CheckoutSummaryPreview({
  quote,
  subject,
}: {
  quote: QuoteResponse["quote"];
  subject: string;
}) {
  const model = summaryFromQuote(quote, subject);
  return (
    <CheckoutSummary
      currency={quote.currency}
      lines={model.lines}
      perks={model.perks}
      fee={model.fee}
      totalMinor={model.totalMinor}
    />
  );
}
