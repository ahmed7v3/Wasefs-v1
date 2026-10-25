import { revisionSummarySchema } from "@wasfa/shared/schemas/content";
import { z } from "zod";

/*
 * Response shapes the editor reads that the shared contract does not name (CONTENT-PLATFORM §11.4):
 * the writes answer with the item or a small acknowledgement, and the revision list may be a bare
 * array or an `{ items }` envelope. Each schema takes only the fields the editor uses, so an API that
 * returns more (the whole detail after a PATCH) still parses. The editor never trusts a write response
 * for state: it refetches the detail.
 */

/** `POST /admin/content/items`: only the new id is needed to move to `/admin/content/<id>`. */
export const createdItemSchema = z.object({ id: z.uuid() });

/** `PUT items/:id/autosave`. */
export const autosaveAckSchema = z.object({ savedAt: z.string().optional() });

/** `GET items/:id/revisions`. */
export const revisionListSchema = z
  .union([z.array(revisionSummarySchema), z.object({ items: z.array(revisionSummarySchema) })])
  .transform((value) => (Array.isArray(value) ? value : value.items));

export const DEFAULT_EDITOR_SETTINGS = {
  timeZone: "Africa/Cairo",
  featuredMinWidth: 1200,
  minWords: { article: 600, guide: 1200, glossary: 80 },
} as const;

export interface EditorSettings {
  timeZone: string;
  featuredMinWidth: number;
  minWords: { article: number; guide: number; glossary: number };
}
