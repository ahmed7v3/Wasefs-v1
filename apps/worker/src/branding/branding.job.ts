import { BRANDING_GENERATED_KEYS } from "@wasfa/shared/schemas/branding";

import { readSetting } from "../settings.js";

import { findSymbol, lastWritten, storeIcon } from "./branding.repo.js";
import { renderIcons } from "./render-icons.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type BrandingContext = Pick<JobContext, "db" | "logger">;

/**
 * `branding.icons`: renders the icon set from the `symbol` the admin uploaded (sha256 in the
 * payload) and stores each icon like an upload (previous version archived). Rules:
 *  - Stale job: the live symbol is not the one the job was queued for, so a newer upload owns the
 *    work and this one does nothing.
 *  - Individual overrides: a key written AFTER the symbol (its `updated_at` is later than the
 *    symbol's) is left alone. That is an icon the admin uploaded by hand after the last symbol
 *    change, or one an earlier attempt of this same job already wrote, which also makes a retry
 *    idempotent. A key older than the symbol belongs to the previous symbol and is replaced.
 *  - An icon that does not fit its budget is skipped with a warning, the rest are still stored.
 * A symbol that cannot be decoded throws, and the queue's retries end in a failed job (logged).
 */
export async function brandingIconsJob(
  { sha256 }: JobPayload<"images", "branding.icons">,
  { db, logger }: BrandingContext,
): Promise<void> {
  const symbol = await findSymbol(db);
  if (symbol === null || symbol.sha256 !== sha256) {
    logger.info({ sha256, live: symbol?.sha256 ?? null }, "Brand icons skipped: symbol changed");
    return;
  }

  const { themeColor } = await readSetting(db, "branding");
  const icons = await renderIcons(symbol.data, themeColor);

  const skipped: string[] = [];
  for (const icon of icons) {
    const written = await lastWritten(db, icon.key);
    if (written !== null && written > symbol.updatedAt) {
      skipped.push(icon.key);
      continue;
    }
    await storeIcon(db, icon);
  }
  const missing = BRANDING_GENERATED_KEYS.filter((key) => !icons.some((icon) => icon.key === key));
  if (missing.length > 0) logger.warn({ sha256, missing }, "Brand icons over budget, not stored");
  logger.info(
    { sha256, stored: icons.length - skipped.length, kept: skipped },
    "Brand icons rendered",
  );
}
