import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { CHAT_TITLE_MAX_CHARS } from "@wasfa/shared/schemas/chat";
import { PinoLogger } from "nestjs-pino";

import { AiRuntimeService } from "../ai-runtime/ai-runtime.service.js";

import { CONTEXT_MIN_MESSAGES, wrapUserData, type HistoryRow } from "./chat-context.js";
import { SUMMARY_SYSTEM_PROMPT, TITLE_SYSTEM_PROMPT } from "./chat-prompts.js";
import { ChatRepo } from "./chat.repo.js";

import type { AiTask } from "@wasfa/shared/ai";

/** A summary is refreshed after every this-many answered turns. */
export const SUMMARY_EVERY_ANSWERS = 10;
const HELPER_TIMEOUT_MS = 30_000;
const TRANSCRIPT_MESSAGE_CHARS = 2_000;
const TRANSCRIPT_TOTAL_CHARS = 30_000;
const SUMMARY_MAX_CHARS = 4_000;

/** A model-written title made safe to show: one line, no quotes or markup, at most 60 characters. */
export function cleanTitle(raw: string): string | null {
  const line = raw.split("\n").find((part) => part.trim() !== "") ?? "";
  const text = line
    .replace(/[*_`#>]/g, "")
    .replace(/^["'«»“”‘’\s]+|["'«»“”‘’\s.،:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  return Array.from(text).slice(0, CHAT_TITLE_MAX_CHARS).join("");
}

/** When the title task is unavailable the chat still gets a readable name: the start of the question. */
export function fallbackTitle(question: string): string | null {
  return cleanTitle(question.replace(/\s+/g, " ").trim());
}

function transcript(rows: readonly HistoryRow[]): string {
  let total = 0;
  const lines: string[] = [];
  for (const row of rows) {
    if (row.role === "system" || row.content.trim() === "") continue;
    if (row.role === "assistant" && row.status !== "done" && row.status !== "stopped") continue;
    const text = row.content.slice(0, TRANSCRIPT_MESSAGE_CHARS);
    const line = row.role === "user" ? `User: ${wrapUserData(text)}` : `Assistant: ${text}`;
    if (total + line.length > TRANSCRIPT_TOTAL_CHARS) break;
    total += line.length;
    lines.push(line);
  }
  return lines.join("\n\n");
}

export interface AfterTurn {
  userId: string;
  chatId: string;
  planId: string;
  /** The chat had no title when the turn started. */
  needsTitle: boolean;
  /** The turn finished normally (a stopped or failed answer triggers nothing). */
  completed: boolean;
}

/**
 * Work that follows an answer but must never delay it: the chat's title after its first answer and
 * the rolling summary every tenth answer. It runs in this process after the stream has ended; a
 * failure is logged and forgotten (the chat works without either). The cheap helper tasks are part
 * of the chat's price, so they charge no credits.
 */
@Injectable()
export class ChatBackground implements OnApplicationShutdown {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly repo: ChatRepo,
    private readonly ai: AiRuntimeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("ChatBackground");
  }

  /** Starts the follow-up work and returns at once. */
  afterTurn(turn: AfterTurn): void {
    if (!turn.completed) return;
    this.track(async () => {
      if (turn.needsTitle) await this.title(turn);
      const answered = await this.repo.answeredCount(turn.userId, turn.chatId);
      if (answered > 0 && answered % SUMMARY_EVERY_ANSWERS === 0) await this.summarize(turn);
    });
  }

  /** Resolves when everything started so far has finished (shutdown and tests). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private track(job: () => Promise<void>): void {
    const promise: Promise<void> = job()
      .catch((error: unknown) => {
        // Ids only: never the chat's text.
        this.logger.warn(
          { err: error instanceof Error ? error.name : "unknown" },
          "Chat follow-up failed",
        );
      })
      .finally(() => {
        this.pending.delete(promise);
      });
    this.pending.add(promise);
  }

  private async title(turn: AfterTurn): Promise<void> {
    const [first, second] = await this.repo.messagesAfter(turn.userId, turn.chatId, null, 2);
    const question = first?.role === "user" ? first.content : "";
    if (question.trim() === "") return;
    let title: string | null;
    try {
      const prompt = `${wrapUserData(question.slice(0, 1_000))}\n\nAnswer start:\n${(second?.content ?? "").slice(0, 600)}`;
      title = cleanTitle(await this.complete("title_gen", turn, TITLE_SYSTEM_PROMPT, prompt, 40));
    } catch {
      title = null;
    }
    title ??= fallbackTitle(question);
    if (title !== null) await this.repo.setTitleIfEmpty(turn.userId, turn.chatId, title);
  }

  private async summarize(turn: AfterTurn): Promise<void> {
    const previous = await this.repo.summaryOf(turn.userId, turn.chatId);
    const rows = await this.repo.messagesAfter(
      turn.userId,
      turn.chatId,
      previous?.throughMessageId ?? null,
      200,
    );
    // The last messages stay verbatim in the prompt; the summary covers what falls behind them.
    const covered = rows.slice(0, Math.max(0, rows.length - CONTEXT_MIN_MESSAGES));
    const last = covered.at(-1);
    if (!last) return;
    const body = transcript(covered);
    if (body === "") return;
    const prompt = `${previous ? `Previous summary:\n<chat_summary>\n${previous.summary}\n</chat_summary>\n\n` : ""}New messages:\n${body}`;
    const summary = (
      await this.complete("summarize", turn, SUMMARY_SYSTEM_PROMPT, prompt, 700)
    ).trim();
    if (summary !== "") {
      await this.repo.saveSummary(turn.chatId, summary.slice(0, SUMMARY_MAX_CHARS), last.id);
    }
  }

  private async complete(
    task: AiTask,
    turn: AfterTurn,
    system: string,
    prompt: string,
    maxOutputTokens: number,
  ): Promise<string> {
    let text = "";
    const signal = AbortSignal.timeout(HELPER_TIMEOUT_MS);
    for await (const event of this.ai.run(
      {
        task,
        mode: "fast",
        planId: turn.planId,
        request: {
          system,
          messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
          maxOutputTokens,
        },
        ownerUserId: turn.userId,
        userId: turn.userId,
      },
      signal,
    )) {
      if (event.type === "text") text += event.text;
    }
    return text;
  }
}
