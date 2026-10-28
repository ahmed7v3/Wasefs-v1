import { z } from "zod";

import { DRUG_STATUSES } from "../ai.js";

/*
 * Medication search for users (docs/MEDICATIONS.md section 6) and the reference cards of the website
 * assistant (section 5). Read-only views of the `drugs` table: prices are integer minor units with a
 * currency, and are null when the admin switched prices off (`medications.search.showPrices`).
 */

export const MEDICATION_PAGE_SIZE = 20;
export const MEDICATION_QUERY_MAX = 80;

const isoDate = z.iso.datetime({ offset: true });

export const medicationSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(MEDICATION_QUERY_MAX),
  category: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(40).optional(),
});
export type MedicationSearchQuery = z.output<typeof medicationSearchQuerySchema>;

export const medicationSummarySchema = z.object({
  id: z.uuid(),
  brandEn: z.string(),
  brandAr: z.string().nullable(),
  brandKey: z.string(),
  form: z.string().nullable(),
  strengthText: z.string().nullable(),
  packText: z.string().nullable(),
  category: z.string().nullable(),
  manufacturer: z.string().nullable(),
  /** Active ingredient names, alphabetical. */
  ingredients: z.array(z.string()),
  priceMinor: z.number().int().nonnegative().nullable(),
  currency: z.string(),
  priceUpdatedAt: isoDate.nullable(),
});
export type MedicationSummary = z.infer<typeof medicationSummarySchema>;

export const medicationIngredientSchema = z.object({
  name: z.string(),
  strength: z.string().nullable(),
});
export type MedicationIngredient = z.infer<typeof medicationIngredientSchema>;

export const medicationDetailSchema = medicationSummarySchema.extend({
  oldPriceMinor: z.number().int().nonnegative().nullable(),
  unitsCount: z.number().int().positive().nullable(),
  barcode: z.string().nullable(),
  status: z.enum(DRUG_STATUSES),
  ingredientStrengths: z.array(medicationIngredientSchema),
});
export type MedicationDetail = z.infer<typeof medicationDetailSchema>;

export const medicationSearchResponseSchema = z.object({
  items: z.array(medicationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type MedicationSearchResponse = z.infer<typeof medicationSearchResponseSchema>;

export const medicationDetailResponseSchema = z.object({
  medication: medicationDetailSchema,
  /** Same active-ingredient set, cheapest first. */
  alternatives: z.array(medicationSummarySchema),
});
export type MedicationDetailResponse = z.infer<typeof medicationDetailResponseSchema>;

/** A compact reference card for the website assistant's prompt: a brand family or an ingredient. */
export const medicationCardSchema = z.object({
  kind: z.enum(["brand", "ingredient"]),
  title: z.string(),
  ingredients: z.array(z.string()),
  strengths: z.array(z.string()),
  forms: z.array(z.string()),
  category: z.string().nullable(),
  priceMinMinor: z.number().int().nonnegative().nullable(),
  priceMaxMinor: z.number().int().nonnegative().nullable(),
  currency: z.string(),
});
export type MedicationCard = z.infer<typeof medicationCardSchema>;
