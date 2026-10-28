import { formatMoney } from "@wasfa/shared/money";
import { z } from "zod";

import { defineTool } from "./tool.js";

import type { MedicationSummary } from "@wasfa/shared/schemas/medications";

/** Entries a medication tool returns: enough to choose from, short enough for a WhatsApp reply. */
export const MEDICATION_TOOL_LIMIT = 5;

/** One entry as the model reads it. Prices are approximate lists and left out when the admin hides them. */
function entry(item: MedicationSummary, showPrices: boolean) {
  return {
    id: item.id,
    brand: item.brandEn,
    ...(item.brandAr === null ? {} : { brandAr: item.brandAr }),
    ingredients: item.ingredients,
    strength: item.strengthText,
    form: item.form,
    pack: item.packText,
    manufacturer: item.manufacturer,
    ...(showPrices && item.priceMinor !== null
      ? {
          approximatePrice: {
            amountMinor: item.priceMinor,
            currency: item.currency,
            formatted: formatMoney(item.priceMinor, item.currency, "ar"),
            updatedAt: item.priceUpdatedAt,
          },
        }
      : {}),
  };
}

/**
 * Looks a medicine up by name in the platform's Egyptian medication database. Facts only (name,
 * ingredients, strength, form, pack, approximate price): the agent never adds medical advice to them.
 */
export const searchMedicationsTool = defineTool({
  definition: {
    name: "search_medications",
    description:
      "Search the platform's Egyptian medication database by brand or active ingredient name (Arabic or English, barcode digits also work). Returns up to 5 entries with ingredients, strength, form, pack and approximate price. Use it for questions about a medicine's price, what it contains or whether it exists. Never for diagnosis or dosing; say only what the result contains and that prices are approximate.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The medicine name as the customer wrote it.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  schema: z.object({ query: z.string().trim().min(1).max(80) }),
  linkedOnly: false,
  feature: "medications",
  handler: async (ctx, args) => {
    const [items, showPrices] = await Promise.all([
      ctx.deps.medications.search(args.query, MEDICATION_TOOL_LIMIT),
      ctx.deps.medications.showPrices(),
    ]);
    return { count: items.length, medications: items.map((item) => entry(item, showPrices)) };
  },
});

/** The same active ingredients in other brands, cheapest first. */
export const medicationAlternativesTool = defineTool({
  definition: {
    name: "medication_alternatives",
    description:
      "Other brands with exactly the same active ingredients as a medicine from search_medications, cheapest first (up to 5). Use it when the customer asks for a cheaper or available alternative. It is a list of same-ingredient products, not a recommendation to switch: tell the customer to confirm with their pharmacist or doctor.",
    parameters: {
      type: "object",
      properties: {
        drugId: {
          type: "string",
          description: "The id of a medicine returned by search_medications.",
        },
      },
      required: ["drugId"],
      additionalProperties: false,
    },
  },
  schema: z.object({ drugId: z.uuid() }),
  linkedOnly: false,
  feature: "medications",
  handler: async (ctx, args) => {
    const [items, showPrices] = await Promise.all([
      ctx.deps.medications.alternatives(args.drugId, MEDICATION_TOOL_LIMIT),
      ctx.deps.medications.showPrices(),
    ]);
    return { count: items.length, alternatives: items.map((item) => entry(item, showPrices)) };
  },
});
