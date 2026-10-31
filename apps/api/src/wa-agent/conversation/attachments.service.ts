import { Injectable } from "@nestjs/common";

import { normalizeHandle, rxRefOf } from "./attachment-handle.js";
import { AttachmentsRepo, type AttachmentRow } from "./attachments.repo.js";

/*
 * The attachment registry (docs/WA-AGENT-RUNTIME.md §8.1, §18.5): which pictures and files of the current
 * session exist, in what state, and which of them a tool call may use. Status is derived, never stored.
 */

export type AttachmentKind = "image" | "pdf" | "document";

export type AttachmentStatus =
  | { kind: "ready" }
  | { kind: "expired" }
  | { kind: "failed"; reason: string }
  | { kind: "analysed"; rxRef: string }
  | { kind: "in_progress"; rxRef: string };

export interface Attachment {
  messageId: string;
  handle: number;
  kind: AttachmentKind;
  ageSeconds: number;
  /** The set label (`A`, `B`, ... `AA`) of the burst the file arrived in. */
  set: string | null;
  status: AttachmentStatus;
}

/** Why `resolve` found nothing to read; every code has an `explain` text. */
export type ResolveCode =
  "unknown_handle" | "not_ready" | "already_analysed" | "too_many_pages" | "no_image";

export type Resolution =
  { ok: true; mediaIds: string[]; handles: number[] } | { ok: false; code: ResolveCode };

/** What the model passes to `analyze_prescription`: a set label or handles (`#3` or 3); handles win. */
export interface AttachmentSelection {
  set?: string | undefined;
  handles?: readonly (string | number)[] | undefined;
}

/** A media row with its derived state plus what a viewer needs to read the file. */
export interface FoundAttachment extends Attachment {
  mediaKey: string | null;
  mediaMime: string | null;
  mediaBytes: number;
}

/** `waMessages.mediaStatus` values that mean the file never arrived. */
const FAILED_MEDIA = new Set([
  "too_large",
  "unsupported_type",
  "download_failed",
  "storage_unavailable",
]);
const IN_PROGRESS = new Set(["queued", "processing", "verifying"]);
const SET_LABEL = /^[A-Z]{1,2}$/;

export function attachmentStatus(
  row: Pick<AttachmentRow, "mediaKey" | "mediaStatus" | "rxId" | "rxStatus">,
): AttachmentStatus {
  if (row.mediaStatus !== null && FAILED_MEDIA.has(row.mediaStatus)) {
    return { kind: "failed", reason: row.mediaStatus };
  }
  // An analysed file stays "analysed" after retention deleted it: that is the more useful fact.
  if (row.rxId !== null) {
    const rxRef = rxRefOf(row.rxId);
    return {
      kind: row.rxStatus !== null && IN_PROGRESS.has(row.rxStatus) ? "in_progress" : "analysed",
      rxRef,
    };
  }
  return row.mediaKey === null ? { kind: "expired" } : { kind: "ready" };
}

function attachmentKind(row: Pick<AttachmentRow, "kind" | "mime">): AttachmentKind {
  if (row.kind === "image") return "image";
  return row.mime === "application/pdf" ? "pdf" : "document";
}

function toAttachment(row: AttachmentRow, now: Date): Attachment {
  return {
    messageId: row.messageId,
    handle: row.handle,
    kind: attachmentKind(row),
    ageSeconds: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / 1_000)),
    set: row.setLabel,
    status: attachmentStatus(row),
  };
}

interface Item {
  row: AttachmentRow;
  status: AttachmentStatus;
}

const isUsed = (item: Item) =>
  item.status.kind === "analysed" || item.status.kind === "in_progress";
const isReadable = (item: Item) => item.status.kind === "ready" && item.row.kind === "image";

@Injectable()
export class AttachmentsService {
  constructor(private readonly repo: AttachmentsRepo) {}

  /** The newest `limit` attachments of the session, oldest first: the prompt block. */
  async list(sessionId: string, now: Date, limit = 8): Promise<Attachment[]> {
    return (await this.repo.rows(sessionId, limit)).map((row) => toAttachment(row, now));
  }

  /** One attachment of the session by handle; null when the session has no such handle. */
  async find(sessionId: string, handle: number, now: Date): Promise<FoundAttachment | null> {
    const row = (await this.repo.rows(sessionId)).find((candidate) => candidate.handle === handle);
    if (row === undefined) return null;
    return {
      ...toAttachment(row, now),
      mediaKey: row.mediaKey,
      mediaMime: row.mime,
      mediaBytes: row.mediaBytes ?? 0,
    };
  }

  /**
   * The pictures an `analyze_prescription` call reads, validated against this session (docs §18.5).
   * `handles` win over `set`; with neither, the newest set that still has a ready page. Handles must
   * all be ready images; a set or the default takes only its ready, not yet analysed pages. No time
   * window: a file is usable while its media exists. The ids come back oldest first.
   */
  async resolve(
    sessionId: string,
    selection: AttachmentSelection,
    maxPages: number,
  ): Promise<Resolution> {
    const rows = await this.repo.rows(sessionId);
    const items = rows.map((row): Item => ({ row, status: attachmentStatus(row) }));
    const picked =
      selection.handles !== undefined && selection.handles.length > 0
        ? pickHandles(items, selection.handles)
        : pickSet(items, selection.set);
    if (!picked.ok) return picked;
    if (picked.items.length > maxPages) return { ok: false, code: "too_many_pages" };
    return {
      ok: true,
      mediaIds: picked.items.map((item) => item.row.messageId),
      handles: picked.items.map((item) => item.row.handle),
    };
  }
}

type Picked = { ok: true; items: Item[] } | { ok: false; code: ResolveCode };

function pickHandles(items: readonly Item[], raw: readonly (string | number)[]): Picked {
  const wanted = [...new Set(raw.map(normalizeHandle))];
  const picked: Item[] = [];
  for (const handle of wanted) {
    const item = handle === null ? undefined : items.find((it) => it.row.handle === handle);
    if (item === undefined) return { ok: false, code: "unknown_handle" };
    picked.push(item);
  }
  if (picked.some((item) => item.row.kind !== "image")) return { ok: false, code: "no_image" };
  if (picked.some(isUsed)) return { ok: false, code: "already_analysed" };
  if (!picked.every(isReadable)) return { ok: false, code: "not_ready" };
  return { ok: true, items: picked.sort((a, b) => a.row.handle - b.row.handle) };
}

function pickSet(items: readonly Item[], rawSet: string | undefined): Picked {
  const label = rawSet?.trim().toUpperCase();
  if (label !== undefined && label !== "") {
    if (!SET_LABEL.test(label)) return { ok: false, code: "unknown_handle" };
    const group = items.filter((item) => item.row.setLabel === label);
    if (group.length === 0) return { ok: false, code: "unknown_handle" };
    return readyOf(group);
  }
  // Newest set first: the one the customer is most likely talking about.
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = item.row.setLabel ?? `h${item.row.handle}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of [...groups.values()].reverse()) {
    if (group.some(isReadable)) return readyOf(group);
  }
  return items.some(isUsed)
    ? { ok: false, code: "already_analysed" }
    : { ok: false, code: "no_image" };
}

/** The ready pages of one set, or why it has none. */
function readyOf(group: readonly Item[]): Picked {
  const ready = group.filter(isReadable);
  if (ready.length > 0) return { ok: true, items: ready };
  if (group.some(isUsed)) return { ok: false, code: "already_analysed" };
  return group.some((item) => item.row.kind === "image")
    ? { ok: false, code: "not_ready" }
    : { ok: false, code: "no_image" };
}
