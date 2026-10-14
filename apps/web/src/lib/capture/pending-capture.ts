import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { z } from "zod";

/*
 * The dashboard's quick capture uploads pages and then opens `/analyze`; this hands the uploaded
 * file ids over. `sessionStorage` (this tab only, gone when it closes) rather than the URL: the
 * ids stay out of history, referrers and shared links. Only ids are stored, never a picture, and
 * the API still checks that every file belongs to the caller when Analyze is pressed.
 */

const KEY = "wasfa:capture:pending";
/** A hand-over older than this is stale (the person wandered off): ignored. */
const TTL_MS = 10 * 60 * 1000;

const pendingSchema = z.object({
  fileIds: z.array(z.uuid()).min(1).max(RX_MAX_PAGES),
  at: z.number(),
});

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Storage blocked (private mode, policy): the hand-over simply does not happen.
    return null;
  }
}

/** Remembers the uploaded pages for the next `/analyze` visit. Returns false when it could not. */
export function stashPendingCapture(fileIds: readonly string[], now = Date.now()): boolean {
  const parsed = pendingSchema.safeParse({ fileIds, at: now });
  const store = storage();
  if (!parsed.success || !store) return false;
  try {
    store.setItem(KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

/** The stashed file ids, or an empty list when there are none, they are stale or malformed. Does not consume. */
export function peekPendingCapture(now = Date.now()): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (raw === null) return [];
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || now - parsed.data.at > TTL_MS || parsed.data.at > now + 60_000) {
      return [];
    }
    return parsed.data.fileIds;
  } catch {
    return [];
  }
}

export function clearPendingCapture(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to clean when storage is unavailable.
  }
}
