import {
  publishingKeyInputSchema,
  publishingKeyUpdatableFields,
  type PublishingKeyInput,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { z } from "zod";

type UpdatableField = (typeof publishingKeyUpdatableFields)[number];
export type PublishingKeyPatch = Partial<Pick<PublishingKeyInput, UpdatableField>>;

/**
 * PATCH body: each updatable field of the create schema without its default (a plain `.partial()`
 * would refill the defaults and silently reset what the caller did not send). Strict, so a request
 * that tries to change `environment`, the owner or the secret fails instead of being ignored.
 */
const shape: Record<string, z.ZodType> = {};
for (const field of publishingKeyUpdatableFields) {
  const original: z.ZodType = publishingKeyInputSchema.shape[field];
  shape[field] = z.optional(original instanceof z.ZodDefault ? original.removeDefault() : original);
}

export const publishingKeyPatchSchema = z
  .object(shape)
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "empty_patch",
  }) as unknown as z.ZodType<PublishingKeyPatch>;
