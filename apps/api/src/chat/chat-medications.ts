import { Inject, Injectable } from "@nestjs/common";
import { medicationCardsFor } from "@wasfa/db";
import { fromMinor } from "@wasfa/shared/money";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { SettingsService } from "../settings/settings.service.js";

import type { MedicationCard } from "@wasfa/shared/schemas/medications";

/*
 * Reference cards for the website assistant (docs/MEDICATIONS.md section 5): the medicines named in the
 * user's message are looked up exactly in the medication database and handed to the model as one more
 * system block. No tool calls, no extra model call, nothing when no medicine is named.
 */

export const MEDICATION_REFERENCE_HEADER =
  "Reference data from Wasfa's Egyptian medication database (may be incomplete or outdated; prices approximate)";
const MEDICATION_REFERENCE_HEADER_AR =
  "بيانات مرجعية من قاعدة أدوية وصفة المصرية (قد تكون ناقصة أو قديمة، والأسعار تقريبية)";

/** "12.50-40.00 EGP", "12.50 EGP", or null when the card has no price. */
function priceRange(card: MedicationCard): string | null {
  const { priceMinMinor: min, priceMaxMinor: max, currency } = card;
  if (min === null || max === null) return null;
  const low = fromMinor(min, currency);
  const high = fromMinor(max, currency);
  return `${low === high ? low : `${low}-${high}`} ${currency}`;
}

/**
 * The system block for these cards, or `null` when there are none. One line per card, about 60 tokens
 * each. Prices only when the admin allows them.
 */
export function formatMedicationReference(
  cards: readonly MedicationCard[],
  showPrices: boolean,
): string | null {
  if (cards.length === 0) return null;
  const lines = cards.map((card) => {
    const price = showPrices ? priceRange(card) : null;
    const parts = [
      `${card.kind === "brand" ? "brand" : "active ingredient"}: ${card.title}`,
      card.kind === "brand" && card.ingredients.length > 0
        ? `contains ${card.ingredients.join(" + ")}`
        : null,
      card.strengths.length > 0 ? `strengths ${card.strengths.join(", ")}` : null,
      card.forms.length > 0 ? `forms ${card.forms.join(", ")}` : null,
      card.category === null ? null : `category ${card.category}`,
      price === null ? null : `price ${price}`,
    ];
    return `- ${parts.filter((part) => part !== null).join("; ")}`;
  });
  return `${MEDICATION_REFERENCE_HEADER}\n${MEDICATION_REFERENCE_HEADER_AR}\n${lines.join("\n")}`;
}

/** Builds the block for one chat turn. Never throws: a database failure means no cards. */
@Injectable()
export class ChatMedicationCards {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly settings: SettingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("ChatMedicationCards");
  }

  async blockFor(userText: string): Promise<string | null> {
    try {
      const { enabled, chatCards, search } = await this.settings.get("medications");
      if (!enabled || !chatCards.enabled || chatCards.max <= 0) return null;
      const cards = await medicationCardsFor(this.handle.db, userText, chatCards.max);
      return formatMedicationReference(cards, search.showPrices);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.name : "unknown" },
        "Medication cards unavailable",
      );
      return null;
    }
  }
}
