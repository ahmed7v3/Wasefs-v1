import {
  contentMetaSchema,
  contentPayloadSchema,
  type ContentItemDetail,
  type ContentMeta,
  type ContentPayload,
} from "@wasfa/shared/schemas/content";
import { z } from "zod";

/*
 * Autosave (CONTENT-PLATFORM §4.5): while the draft is dirty and the tab is visible, send the payload
 * every 10 s (a PUT that is NOT a revision), and mirror the unsaved text in localStorage so a crash,
 * a dead battery or a lost connection never costs the writing. The scheduler is a small class around
 * injected timers/visibility so it can be tested with fake timers.
 */

export const AUTOSAVE_INTERVAL_MS = 10_000;

export type AutosaveStatus =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error" };

export interface AutosaveDeps {
  intervalMs?: number;
  now: () => number;
  isVisible: () => boolean;
  /** Serialised payload to send; null when there is nothing to autosave (a new item, a read-only user). */
  snapshot: () => string | null;
  save: (snapshot: string) => Promise<void>;
  onStatus: (status: AutosaveStatus) => void;
}

export class AutosaveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSaved: string | null;
  private saving = false;
  private waitingForVisibility = false;
  private disposed = false;
  private readonly interval: number;

  constructor(
    private readonly deps: AutosaveDeps,
    /** The serialised server copy: a snapshot equal to it needs no save. */
    baseline: string | null,
  ) {
    this.lastSaved = baseline;
    this.interval = deps.intervalMs ?? AUTOSAVE_INTERVAL_MS;
  }

  /** The text changed. At most one save per interval: the first change starts the clock. */
  notifyChange(): void {
    if (this.disposed || this.timer !== null || this.saving) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.interval);
  }

  /** The tab became visible again: a save postponed while hidden runs now. */
  notifyVisibility(): void {
    if (this.disposed || !this.waitingForVisibility || !this.deps.isVisible()) return;
    this.waitingForVisibility = false;
    void this.run();
  }

  /** An explicit save (or a reload) made `snapshot` the server copy. */
  markSaved(snapshot: string | null): void {
    this.lastSaved = snapshot;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    if (this.disposed || this.saving) return;
    if (!this.deps.isVisible()) {
      this.waitingForVisibility = true;
      return;
    }
    const snapshot = this.deps.snapshot();
    if (snapshot === null || snapshot === this.lastSaved) return;
    this.saving = true;
    this.deps.onStatus({ kind: "saving" });
    try {
      await this.deps.save(snapshot);
      this.lastSaved = snapshot;
      this.deps.onStatus({ kind: "saved", at: this.deps.now() });
    } catch {
      this.deps.onStatus({ kind: "error" });
    } finally {
      this.saving = false;
    }
    // Typing continued during the request (or it failed): try again after the interval.
    const latest = this.deps.snapshot();
    if (!this.disposed && latest !== null && latest !== this.lastSaved) this.notifyChange();
  }
}

// ---------------------------------------------------------------------------------------------
// Local mirror (localStorage)
// ---------------------------------------------------------------------------------------------

const mirrorSchema = z.object({
  savedAt: z.number(),
  baseRevisionId: z.string().nullable(),
  payload: contentPayloadSchema,
  // A new item has no slug yet, which the contract's slug rule would refuse.
  meta: contentMetaSchema.extend({ slug: z.string() }),
});
export type LocalMirror = z.output<typeof mirrorSchema>;

const mirrorKey = (itemKey: string): string => `wasfa.content-editor.v1:${itemKey}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Access can throw (blocked storage, private mode).
    return null;
  }
}

export function writeMirror(itemKey: string, mirror: LocalMirror): void {
  try {
    storage()?.setItem(mirrorKey(itemKey), JSON.stringify(mirror));
  } catch {
    // Quota exceeded or storage blocked: the server autosave still covers the text.
  }
}

export function readMirror(itemKey: string): LocalMirror | null {
  try {
    const raw = storage()?.getItem(mirrorKey(itemKey));
    if (!raw) return null;
    const parsed = mirrorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearMirror(itemKey: string): void {
  try {
    storage()?.removeItem(mirrorKey(itemKey));
  } catch {
    // Nothing to do.
  }
}

/** The key of an item that does not exist yet (`/new`). */
export const newItemMirrorKey = (type: string, locale: string): string => `new:${type}:${locale}`;

// ---------------------------------------------------------------------------------------------
// Restore offer
// ---------------------------------------------------------------------------------------------

export interface RestoreOffer {
  source: "server" | "local";
  payload: ContentPayload;
  /** Only the local mirror carries unsaved metadata. */
  meta: ContentMeta | null;
  savedAt: number;
}

const samePayload = (a: ContentPayload, b: ContentPayload): boolean =>
  a.title === b.title &&
  a.excerpt === b.excerpt &&
  a.definition === b.definition &&
  a.bodyMd === b.bodyMd;

/**
 * Which unsaved copy is worth offering on load: the server autosave when it differs from the saved
 * revision, the local mirror when it differs AND is newer than both the autosave and the last server
 * change (an older mirror is a stale leftover, restoring it would undo someone's work).
 */
export function pickRestoreOffer(
  detail: ContentItemDetail,
  mirror: LocalMirror | null,
): RestoreOffer | null {
  const autosaveAt = detail.autosave ? Date.parse(detail.autosave.savedAt) : 0;
  const serverOffer: RestoreOffer | null =
    detail.autosave && !samePayload(detail.autosave.payload, detail.payload)
      ? { source: "server", payload: detail.autosave.payload, meta: null, savedAt: autosaveAt }
      : null;

  const newestServerChange = Math.max(autosaveAt, Date.parse(detail.updatedAt));
  const localDiffers =
    mirror !== null &&
    (!samePayload(mirror.payload, detail.payload) ||
      JSON.stringify(mirror.meta) !== JSON.stringify(detail.meta));
  const localOffer: RestoreOffer | null =
    mirror !== null && localDiffers && mirror.savedAt > newestServerChange
      ? { source: "local", payload: mirror.payload, meta: mirror.meta, savedAt: mirror.savedAt }
      : null;

  if (serverOffer && localOffer)
    return localOffer.savedAt > serverOffer.savedAt ? localOffer : serverOffer;
  return localOffer ?? serverOffer;
}
