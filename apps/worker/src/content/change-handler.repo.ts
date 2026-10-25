import { contentItems, type Transaction } from "@wasfa/db";
import { eq } from "drizzle-orm";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

export interface ChangedItemRow {
  type: ContentType;
  locale: ContentLocale;
  noindex: boolean;
}

/** Type, locale and robots flag of the item an event is about; null when the item is gone. */
export async function findChangedItem(
  tx: Transaction,
  itemId: string,
): Promise<ChangedItemRow | null> {
  const [row] = await tx
    .select({ type: contentItems.type, locale: contentItems.locale, seo: contentItems.seo })
    .from(contentItems)
    .where(eq(contentItems.id, itemId))
    .limit(1);
  if (!row) return null;
  return { type: row.type, locale: row.locale, noindex: row.seo.robots === "noindex" };
}
