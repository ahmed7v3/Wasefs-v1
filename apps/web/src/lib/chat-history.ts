import type { ChatSummaryView } from "@wasfa/shared/schemas/chat";

export type ChatGroupKey = "today" | "yesterday" | "week" | "older";

export interface ChatGroup {
  key: ChatGroupKey;
  items: ChatSummaryView[];
}

/** Midnight of the local day `back` days before `date` (calendar arithmetic, so DST cannot shift it). */
function startOfDay(date: Date, back = 0): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back).getTime();
}

/**
 * Buckets chats by the local calendar day of their last activity: today, yesterday, the 7 days
 * before that, and older. The input order (newest first) is kept inside each bucket; empty
 * buckets are left out.
 */
export function groupChatsByDate(items: readonly ChatSummaryView[], now: Date): ChatGroup[] {
  const today = startOfDay(now);
  const yesterday = startOfDay(now, 1);
  const weekAgo = startOfDay(now, 7);
  const buckets: Record<ChatGroupKey, ChatSummaryView[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  };
  for (const item of items) {
    const day = startOfDay(new Date(item.updatedAt));
    const key: ChatGroupKey =
      day >= today ? "today" : day >= yesterday ? "yesterday" : day >= weekAgo ? "week" : "older";
    buckets[key].push(item);
  }
  return (["today", "yesterday", "week", "older"] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}
