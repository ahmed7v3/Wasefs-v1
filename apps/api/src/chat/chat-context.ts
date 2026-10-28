import type { ChatMessage, MessagePart, NormalizedMessage } from "@wasfa/ai";

/*
 * What the model is shown for one chat turn (phase2.md Task 2.11, "Context policy"):
 *   system prompt (stable) -> skill body -> rolling summary -> recent messages -> the new message.
 * The system, skill and summary go in `system`; the recent messages and the new one are `messages`.
 * Pure functions: the service loads rows, these shape and trim them.
 */

/** Messages always kept verbatim, however long the chat is. */
export const CONTEXT_MIN_MESSAGES = 12;
/** Characters of verbatim history, trimmed oldest-first. About 8k tokens of Arabic. */
export const CONTEXT_MAX_HISTORY_CHARS = 24_000;
/** Tokens an image costs the input estimate (Gemini media tokens at the default resolution). */
export const IMAGE_INPUT_TOKENS = 1_120;

export interface HistoryRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "streaming" | "done" | "stopped" | "error";
}

/** The user's text wrapped as data; a closing tag typed by the user cannot end the wrapper early. */
export function wrapUserData(text: string): string {
  return `<user_data>\n${text.replaceAll("</user_data", "<\\/user_data")}\n</user_data>`;
}

function wrapSummary(summary: string): string {
  return `<chat_summary>\n${summary.replaceAll("</chat_summary", "<\\/chat_summary")}\n</chat_summary>`;
}

/**
 * The messages worth showing again: answered turns and the user's questions. A failed or empty
 * answer is skipped (a question left without an answer simply merges with the next one).
 */
function usable(row: HistoryRow): boolean {
  if (row.role === "system" || row.content.trim() === "") return false;
  return row.role === "user" || row.status === "done" || row.status === "stopped";
}

/**
 * Recent messages for the prompt. `rows` are oldest first and already end before the new message.
 * Everything after the summary's last message stays (nothing falls between the summary and the
 * window) and never fewer than the last `CONTEXT_MIN_MESSAGES`; then the oldest go until the
 * characters fit. The result starts with a user message and strictly alternates (providers refuse
 * two turns of the same role in a row).
 */
export function recentHistory(
  rows: readonly HistoryRow[],
  summaryThroughId: string | null,
  maxChars = CONTEXT_MAX_HISTORY_CHARS,
): ChatMessage[] {
  // -1 when there is no summary, or its last message is older than the rows we were given.
  const throughIndex =
    summaryThroughId === null ? -1 : rows.findIndex((row) => row.id === summaryThroughId);
  const start = Math.min(throughIndex + 1, Math.max(0, rows.length - CONTEXT_MIN_MESSAGES));

  const merged: { role: "user" | "assistant"; text: string }[] = [];
  for (const row of rows.slice(start).filter(usable)) {
    const role = row.role === "assistant" ? "assistant" : "user";
    const text = role === "user" ? wrapUserData(row.content) : row.content;
    const last = merged.at(-1);
    if (last?.role === role) last.text = `${last.text}\n\n${text}`;
    else merged.push({ role, text });
  }

  let total = merged.reduce((sum, item) => sum + item.text.length, 0);
  while (merged.length > 0 && (total > maxChars || merged[0]?.role !== "user")) {
    const dropped = merged.shift();
    total -= dropped?.text.length ?? 0;
  }
  return merged.map((item) => ({ role: item.role, parts: [{ type: "text", text: item.text }] }));
}

export interface PromptInput {
  systemPrompt: string;
  skillBody: string | null;
  summary: string | null;
  history: ChatMessage[];
  userText: string;
  images: { mime: string; data: Uint8Array }[];
  /** Medication reference cards for the medicines named in the message (`chat-medications.ts`). */
  medicationReference?: string | null;
}

export interface BuiltPrompt {
  system: string;
  messages: NormalizedMessage[];
  /** Characters of text in the prompt, for the input-token estimate. */
  inputChars: number;
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const sections = [input.systemPrompt];
  if (input.skillBody !== null && input.skillBody.trim() !== "")
    sections.push(input.skillBody.trim());
  const reference = input.medicationReference?.trim() ?? "";
  if (reference !== "") sections.push(reference);
  if (input.summary !== null && input.summary.trim() !== "") {
    sections.push(
      `Summary of the earlier part of this chat:\n${wrapSummary(input.summary.trim())}`,
    );
  }
  const system = sections.join("\n\n");

  const parts: MessagePart[] = [
    ...input.images.map((image): MessagePart => ({
      type: "image",
      mime: image.mime,
      data: image.data,
    })),
    { type: "text", text: wrapUserData(input.userText) },
  ];
  const messages: NormalizedMessage[] = [...input.history, { role: "user", parts }];

  let inputChars = system.length;
  for (const message of input.history) {
    for (const part of message.parts) if (part.type === "text") inputChars += part.text.length;
  }
  inputChars += wrapUserData(input.userText).length;
  return { system, messages, inputChars };
}
