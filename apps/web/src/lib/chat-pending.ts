import type { AiMode } from "@wasfa/shared/ai";

/*
 * A first message typed on `/ai` creates the chat and then moves to `/ai/<id>`; this hands the message
 * over to the page that streams the answer. It lives in memory on purpose: a reload loses nothing
 * that was not already sent, and nothing about the question is written to storage.
 */

export interface PendingSend {
  chatId: string;
  content: string;
  fileIds: string[];
  mode: AiMode;
  search: boolean;
}

let pending: PendingSend | null = null;

export function stashPendingSend(send: PendingSend): void {
  pending = send;
}

/** Hands the message to the chat page once; any other chat id gets nothing. */
export function takePendingSend(chatId: string): PendingSend | null {
  if (pending?.chatId !== chatId) return null;
  const taken = pending;
  pending = null;
  return taken;
}

/** Tells the history list to reload (a chat was created, renamed, titled or deleted). */
export const CHATS_CHANGED_EVENT = "wasfa:chats-changed";

export function announceChatsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHATS_CHANGED_EVENT));
}
