import { CONTENT_SLUG_PATTERN } from "@wasfa/shared/content/constants";
import {
  categoryInputSchema,
  contentSlugSchema,
  personInputSchema,
  tagInputSchema,
} from "@wasfa/shared/schemas/content";
import { MEDIA_LICENCES } from "@wasfa/shared/schemas/media";
import { z } from "zod";

/*
 * Form-side versions of the taxonomy and people input schemas. The forms hold text, so a blank optional
 * field is "" in the form and `null` on the wire: each of these is the shared schema with the blank →
 * null step in front of the optional fields. They are still the shared rules (same bounds, same slug
 * pattern), not a second contract.
 */

const blankToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable());
const optionalSlug = z.preprocess(blankToNull, contentSlugSchema.nullable());
const optionalId = z.preprocess(blankToNull, z.uuid().nullable());

export const categoryFormSchema = categoryInputSchema.extend({
  parentId: optionalId,
  slugEn: optionalSlug,
  nameEn: optionalText(100),
  defaultReviewerId: optionalId,
  sort: z.coerce.number().int().min(0).max(100_000),
});

export const tagFormSchema = tagInputSchema
  .extend({
    slugAr: optionalSlug,
    slugEn: optionalSlug,
    nameEn: optionalText(100),
  })
  // A tag is addressed by its slug: at least one language needs one (the API refuses the rest).
  .refine((tag) => tag.slugAr !== null || tag.slugEn !== null, {
    path: ["slugAr"],
    message: "form.required",
  });

export const personFormSchema = personInputSchema.extend({
  nameEn: optionalText(120),
  licenceNumber: optionalText(60),
  photoMediaId: optionalId,
  userId: optionalId,
});

export type CategoryFormValues = z.input<typeof categoryFormSchema>;
export type TagFormValues = z.input<typeof tagFormSchema>;
export type PersonFormValues = z.input<typeof personFormSchema>;

/** The media drawer's form: the fields of `PATCH /admin/media/:id` as text (blank = `null`). */
export const mediaFormSchema = z.object({
  altAr: optionalText(300),
  altEn: optionalText(300),
  caption: optionalText(300),
  credit: optionalText(200),
  licence: z.enum(MEDIA_LICENCES),
  licenceRef: optionalText(300),
  seoFilename: z.preprocess(
    blankToNull,
    z.string().trim().min(1).max(100).regex(CONTENT_SLUG_PATTERN).nullable(),
  ),
  focalX: z.number().int().min(0).max(100),
  focalY: z.number().int().min(0).max(100),
});
export type MediaFormValues = z.input<typeof mediaFormSchema>;
