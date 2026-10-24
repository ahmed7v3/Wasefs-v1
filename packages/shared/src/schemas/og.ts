import { z } from "zod";

/**
 * Open Graph / X card inputs (BRAND-AND-HOMEPAGE §2.1, CONTENT-PLATFORM §5.6). One schema per
 * template; the worker renders from the parsed value and hashes it, so everything that changes a
 * card's pixels is a field here (an image is its sha256 plus focal point, never its bytes).
 */

export const OG_LOCALES = ["ar", "en"] as const;
export type OgLocale = (typeof OG_LOCALES)[number];

export const OG_TEMPLATE_IDS = ["page", "article", "guide", "glossary", "drug", "author"] as const;
export type OgTemplateId = (typeof OG_TEMPLATE_IDS)[number];

export const OG_DOSAGE_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "injection",
  "cream",
  "drops",
  "inhaler",
  "other",
] as const;
export type OgDosageForm = (typeof OG_DOSAGE_FORMS)[number];

const locale = z.enum(OG_LOCALES);
const title = z.string().trim().min(1).max(140);
const short = (max: number) => z.string().trim().min(1).max(max);

/** A library image used inside a card: the asset's content hash and where to centre the crop (percent). */
export const ogImageSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  focalX: z.number().int().min(0).max(100).default(50),
  focalY: z.number().int().min(0).max(100).default(50),
});
export type OgImage = z.infer<typeof ogImageSchema>;

export const ogPageInputSchema = z.object({
  locale,
  title,
  subtitle: short(120).optional(),
});

export const ogArticleInputSchema = z.object({
  locale,
  title,
  category: short(40),
  authorName: short(80).optional(),
  cover: ogImageSchema.optional(),
});

export const ogGuideInputSchema = z.object({
  locale,
  title,
  sectionCount: z.number().int().min(1).max(99),
});

export const ogGlossaryInputSchema = z.object({
  locale,
  /** The term as written, large (e.g. `BID`); Latin terms are laid out left-to-right inside an RTL card. */
  term: short(40),
  /** Its meaning in the card's language. */
  meaning: short(140),
});

export const ogDrugInputSchema = z.object({
  locale,
  nameAr: short(80),
  nameEn: short(80),
  activeIngredient: short(100).optional(),
  drugClass: short(60).optional(),
  dosageForm: z.enum(OG_DOSAGE_FORMS).default("other"),
});

export const ogAuthorInputSchema = z.object({
  locale,
  name: short(80),
  credentials: short(140).optional(),
  photo: ogImageSchema.optional(),
});

export const ogInputSchemas = {
  page: ogPageInputSchema,
  article: ogArticleInputSchema,
  guide: ogGuideInputSchema,
  glossary: ogGlossaryInputSchema,
  drug: ogDrugInputSchema,
  author: ogAuthorInputSchema,
} as const;

export type OgInput<T extends OgTemplateId> = z.infer<(typeof ogInputSchemas)[T]>;

/** `og.render` job payload: which template and its input (validated by the matching schema). */
export const ogRenderPayloadSchema = z.discriminatedUnion("template", [
  z.object({ template: z.literal("page"), input: ogPageInputSchema }),
  z.object({ template: z.literal("article"), input: ogArticleInputSchema }),
  z.object({ template: z.literal("guide"), input: ogGuideInputSchema }),
  z.object({ template: z.literal("glossary"), input: ogGlossaryInputSchema }),
  z.object({ template: z.literal("drug"), input: ogDrugInputSchema }),
  z.object({ template: z.literal("author"), input: ogAuthorInputSchema }),
]);
export type OgRenderPayload = z.infer<typeof ogRenderPayloadSchema>;

/** The generated card's key in the public media bucket; content-addressed, so it never changes. */
export function ogCardKey(template: OgTemplateId, hash: string): string {
  return `og/${template}/${hash}.png`;
}
