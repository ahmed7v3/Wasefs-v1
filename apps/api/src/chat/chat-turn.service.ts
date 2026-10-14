import { Injectable } from "@nestjs/common";
import { AiProviderError, noModelError, type ResolvedRoute, type RouterResult } from "@wasfa/ai";
import { MEDICAL_AI_TASKS, type AiMode, type AiTask } from "@wasfa/shared/ai";
import { AppError, ErrorCode, isAppError } from "@wasfa/shared/errors";
import { newId } from "@wasfa/shared/ids";
import {
  CHAT_MAX_SOURCES,
  chatPartSchema,
  chatSourceSchema,
  isChatSkill,
  type ChatPart,
  type ChatSource,
  type SendMessageInput,
} from "@wasfa/shared/schemas/chat";
import { PinoLogger } from "nestjs-pino";

import { AiRuntimeService } from "../ai-runtime/ai-runtime.service.js";
import { CreditsService } from "../credits/credits.service.js";
import { PlansService } from "../plans/plans.service.js";
import { QuotaService } from "../quota/quota.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { ChatBackground } from "./chat-background.js";
import { buildPrompt, recentHistory, type BuiltPrompt } from "./chat-context.js";
import { reserveCredits, settleCredits } from "./chat-credits.js";
import { ChatImages, type ChatImage } from "./chat-images.js";
import { CHAT_SYSTEM_PROMPT } from "./chat-prompts.js";
import { skillBody } from "./chat-skills.js";
import { ChatRepo } from "./chat.repo.js";

import type { ChatStreamIo } from "./sse.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { Chat, WalletOwner } from "@wasfa/db";

/** Rows read for the prompt: enough for the verbatim window plus the stretch after a summary. */
const CONTEXT_FETCH_LIMIT = 40;

/** Default answer ceilings per mode; a route entry's `maxOutputTokens` overrides them. */
const MAX_OUTPUT_TOKENS: Record<AiMode, number> = { fast: 2_048, balanced: 4_096, deep: 8_192 };

type RouteEntry = ResolvedRoute["attempts"][number];

interface Failure {
  code: string;
  reason?: string;
  ref?: string;
}

const taskOf = (mode: AiMode): AiTask => (mode === "deep" ? "deep_think" : "chat");

/** The first route entry the router would really try for this request (same eligibility rules). */
function firstEligible(
  route: ResolvedRoute,
  task: AiTask,
  needs: { vision: boolean; search: boolean },
): RouteEntry | undefined {
  return route.attempts.find(({ model }) => {
    if (!model.enabled || !model.provider.enabled) return false;
    if (MEDICAL_AI_TASKS.has(task) && model.provider.dataPolicy === "free_tier") return false;
    if (needs.vision && !model.capabilities.includes("vision")) return false;
    if (needs.search && !model.capabilities.includes("search")) return false;
    return true;
  });
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www[.]/, "");
  } catch {
    return "";
  }
}

/**
 * One chat turn, end to end (phase2.md, Task 2.11). Order matters: ownership, plan gates and the
 * kill switch come first and answer with plain JSON errors; then the one-stream lock, then the
 * credit hold, then the messages are stored and only then does the SSE stream open. Whatever
 * happens after that ends in a settled reservation, a stored answer and a released lock.
 */
@Injectable()
export class ChatTurnService {
  constructor(
    private readonly repo: ChatRepo,
    private readonly ai: AiRuntimeService,
    private readonly quota: QuotaService,
    private readonly plans: PlansService,
    private readonly credits: CreditsService,
    private readonly settings: SettingsService,
    private readonly images: ChatImages,
    private readonly background: ChatBackground,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("ChatTurn");
  }

  async send(
    user: AuthenticatedUser,
    chatId: string,
    input: SendMessageInput,
    io: ChatStreamIo,
  ): Promise<void> {
    const chat = await this.repo.require(user.id, chatId);
    const owner: WalletOwner = { type: "user", id: user.id };
    const task = taskOf(input.mode);

    if (input.search) {
      const search = await this.plans.entitlement(owner, "web_search");
      if (!search?.allowed) {
        throw new AppError(ErrorCode.PAYMENT_REQUIRED, { details: { reason: "plan_feature" } });
      }
    }
    await this.ai.assertAvailable(task, { search: input.search });
    // Pictures are checked (and fetched) before the lock so a bad id never holds a stream slot.
    const attached =
      input.regenerate === undefined ? await this.images.load(user.id, input.fileIds) : [];

    const ticket = await this.quota.check({
      ownerUserId: user.id,
      userId: user.id,
      task,
      mode: input.mode,
    });
    try {
      await this.turn({ user, chat, owner, task, input, attached, io });
    } finally {
      await ticket.release();
    }
  }

  private async turn(args: {
    user: AuthenticatedUser;
    chat: Chat;
    owner: WalletOwner;
    task: AiTask;
    input: SendMessageInput;
    attached: ChatImage[];
    io: ChatStreamIo;
  }): Promise<void> {
    const { user, chat, owner, task, input, io } = args;
    const plan = await this.plans.effectivePlan(owner);
    const aiSettings = await this.settings.get("ai");

    // 1. What is being answered: a new question, or the stored one again.
    const recent = await this.repo.recentMessages(user.id, chat.id, CONTEXT_FETCH_LIMIT);
    let history = recent;
    let question = input.content ?? "";
    let images = args.attached;
    let userMessageId = newId();
    let replaceId: string | undefined;
    if (input.regenerate !== undefined) {
      const target = await this.repo.messageOf(user.id, chat.id, input.regenerate);
      if (!target || target.role !== "assistant") throw new AppError(ErrorCode.NOT_FOUND);
      const asked = recent.at(-2);
      if (recent.at(-1)?.id !== target.id || asked?.role !== "user") {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_last_message" } });
      }
      history = recent.slice(0, -2);
      question = asked.content;
      userMessageId = asked.id;
      replaceId = target.id;
      images = await this.storedImages(user.id, chat.id, asked.id);
    } else if (question === "") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["content"] } });
    }

    // 2. The prompt, then the worst-case hold for it.
    const summary = await this.repo.summaryOf(user.id, chat.id);
    const prompt = buildPrompt({
      systemPrompt: CHAT_SYSTEM_PROMPT,
      skillBody: skillBody(isChatSkill(chat.skill) ? chat.skill : null),
      summary: summary?.summary ?? null,
      history: recentHistory(history, summary?.throughMessageId ?? null),
      userText: question,
      images,
    });
    const route = await this.ai.route(task, plan.id, input.mode);
    if (!route) throw noModelError("no_route");
    const first = firstEligible(route, task, {
      vision: images.length > 0,
      search: input.search,
    });
    if (!first) throw noModelError("no_model");
    const maxOutputTokens =
      typeof first.params["maxOutputTokens"] === "number"
        ? first.params["maxOutputTokens"]
        : MAX_OUTPUT_TOKENS[input.mode];
    const assistantMessageId = newId();
    const hold = reserveCredits({
      inputChars: prompt.inputChars,
      imageCount: images.length,
      maxOutputTokens,
      search: input.search,
      pricing: first.model.pricing,
      multiplierBp: first.model.creditMultiplierBp,
      creditValueUsdMicros: aiSettings.creditValueUsdMicros,
    });
    const { reservation } = await this.credits.reserve(owner, hold, {
      idempotencyKey: `chat:${assistantMessageId}:reserve`,
      purpose: "chat",
    });

    // 3. Store the turn. From here on a failure must give the hold back.
    const now = Date.now();
    try {
      await this.repo.insertTurn(user.id, chat.id, {
        ...(replaceId === undefined
          ? {
              user: {
                id: userMessageId,
                chatId: chat.id,
                role: "user" as const,
                content: question,
                parts: images.map((image): ChatPart => ({ type: "image", fileId: image.fileId })),
                status: "done" as const,
                createdAt: new Date(now),
              },
            }
          : { replaceId }),
        assistant: {
          id: assistantMessageId,
          chatId: chat.id,
          role: "assistant",
          status: "streaming",
          createdAt: new Date(now + 1),
        },
      });
    } catch (error) {
      await this.credits.release(reservation.id, "insert_failed").catch(() => undefined);
      throw error;
    }

    // 4. Commit to the stream.
    io.open();
    io.send({ event: "message_id", data: { userMessageId, assistantMessageId } });

    let text = "";
    let thinking = false;
    let thinkingStartedAt = 0;
    let thinkingEndedAt = 0;
    let finishReason: string | undefined;
    let result: RouterResult | undefined;
    let failure: unknown;
    const sources = new Map<string, ChatSource>();

    try {
      const run = this.ai.run(
        {
          task,
          mode: input.mode,
          planId: plan.id,
          request: {
            system: prompt.system,
            messages: prompt.messages,
            maxOutputTokens,
            ...(input.mode === "fast" ? {} : { includeThoughts: true }),
            ...(input.search ? { search: true } : {}),
          },
          ownerUserId: user.id,
          userId: user.id,
          requestId: assistantMessageId,
          estimateInputTokens: Math.ceil(prompt.inputChars / 3),
        },
        io.signal,
      );
      for await (const event of run) {
        switch (event.type) {
          case "thinking":
            if (!thinking) {
              thinking = true;
              thinkingStartedAt = Date.now();
            }
            thinkingEndedAt = Date.now();
            io.send({ event: "thinking", data: { delta: event.text } });
            break;
          case "text":
            if (thinking && text === "") thinkingEndedAt = Date.now();
            text += event.text;
            io.send({ event: "text", data: { delta: event.text } });
            break;
          case "search":
            for (const found of event.sources) {
              const source = chatSourceSchema.safeParse({
                url: found.url,
                title: (found.title?.trim() || domainOf(found.url)).slice(0, 300),
                domain: domainOf(found.url),
              });
              if (!source.success || sources.has(source.data.url)) continue;
              if (sources.size >= CHAT_MAX_SOURCES) break;
              sources.set(source.data.url, source.data);
              io.send({ event: "source", data: source.data });
            }
            break;
          case "done":
            finishReason = event.finishReason;
            break;
          case "result":
            result = event.result;
            break;
          case "usage":
            break;
        }
      }
      if (text === "" && !io.signal.aborted) {
        failure = new AiProviderError(
          finishReason === "safety" ? "content_blocked" : "unavailable",
        );
      }
    } catch (error) {
      failure = error;
    }

    await this.finish({
      user,
      chat,
      owner,
      plan: plan.id,
      reservationId: reservation.id,
      assistantMessageId,
      prompt,
      imageCount: images.length,
      pricing: first,
      creditValueUsdMicros: aiSettings.creditValueUsdMicros,
      text,
      thinkingSeconds: thinking
        ? Math.max(0, Math.round((thinkingEndedAt - thinkingStartedAt) / 1000))
        : null,
      sources: [...sources.values()],
      result,
      failure,
      io,
    });
  }

  /** Settles the hold, stores the answer, tells the client, and starts the follow-up work. */
  private async finish(args: {
    user: AuthenticatedUser;
    chat: Chat;
    owner: WalletOwner;
    plan: string;
    reservationId: string;
    assistantMessageId: string;
    prompt: BuiltPrompt;
    imageCount: number;
    pricing: RouteEntry;
    creditValueUsdMicros: number;
    text: string;
    thinkingSeconds: number | null;
    sources: ChatSource[];
    result: RouterResult | undefined;
    failure: unknown;
    io: ChatStreamIo;
  }): Promise<void> {
    const { io, result } = args;
    const aborted = io.signal.aborted;
    const status = aborted ? "stopped" : args.failure === undefined ? "done" : "error";
    const produced = args.text !== "" || args.thinkingSeconds !== null;

    const owed = settleCredits({
      producedOutput: produced,
      result,
      inputChars: args.prompt.inputChars,
      imageCount: args.imageCount,
      outputChars: args.text.length,
      pricing: args.pricing.model.pricing,
      multiplierBp: args.pricing.model.creditMultiplierBp,
      creditValueUsdMicros: args.creditValueUsdMicros,
    });
    let charged = 0;
    try {
      if (owed > 0) {
        const settled = await this.credits.settle(args.reservationId, owed, {
          ...(result?.usageId ? { aiUsageId: result.usageId } : {}),
        });
        charged = settled.charged;
      } else {
        await this.credits.release(args.reservationId, "no_output");
      }
    } catch (error) {
      // The sweeper returns an unsettled hold when it expires; the answer itself must still be kept.
      this.logger.error(
        { reservationId: args.reservationId, err: error instanceof Error ? error.name : "unknown" },
        "Could not settle a chat reservation",
      );
    }

    const parts: ChatPart[] = [
      ...(args.thinkingSeconds === null
        ? []
        : [{ type: "thought" as const, seconds: Math.min(3_600, args.thinkingSeconds) }]),
      ...args.sources.map((source) => ({ type: "source" as const, ...source })),
    ].filter((part) => chatPartSchema.safeParse(part).success);
    try {
      await this.repo.finishAssistant(args.user.id, args.chat.id, args.assistantMessageId, {
        content: args.text,
        parts,
        status,
        aiUsageId: result?.usageId ?? null,
        creditsCharged: charged,
      });
    } catch (error) {
      this.logger.error(
        {
          messageId: args.assistantMessageId,
          err: error instanceof Error ? error.name : "unknown",
        },
        "Could not store a chat answer",
      );
    }

    try {
      if (charged > 0 || status === "done") {
        let balance = 0;
        try {
          balance = (await this.credits.ensureWallet(args.owner)).balance;
        } catch {
          // The charge is final either way; the client refreshes its balance on its own.
        }
        io.send({ event: "credits", data: { charged, balance } });
      }
      if (status === "error") {
        io.send({ event: "error", data: await this.describe(args.failure, io) });
      } else {
        io.send({ event: "done", data: { status } });
      }
    } finally {
      io.close();
    }

    this.background.afterTurn({
      userId: args.user.id,
      chatId: args.chat.id,
      planId: args.plan,
      needsTitle: args.chat.title === null,
      completed: status === "done",
    });
  }

  /** A failure as the client may see it: codes and reasons only, never provider text. */
  private async describe(error: unknown, io: ChatStreamIo): Promise<Failure> {
    if (isAppError(error)) {
      const reason = error.details?.["reason"];
      const ref =
        error.httpStatus >= 500 && reason !== "ai_paused"
          ? await io.report(error, error.code)
          : undefined;
      return {
        code: error.code,
        ...(typeof reason === "string" ? { reason } : {}),
        ...(ref ? { ref } : {}),
      };
    }
    if (error instanceof AiProviderError) {
      if (error.code === "content_blocked") {
        return { code: ErrorCode.UPSTREAM_UNAVAILABLE, reason: "content_blocked" };
      }
      return {
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        reason: "provider_error",
        ref: await io.report(error, ErrorCode.UPSTREAM_UNAVAILABLE),
      };
    }
    return { code: ErrorCode.INTERNAL, ref: await io.report(error, ErrorCode.INTERNAL) };
  }

  /** Pictures of a question being answered again; ones the retention job has removed are left out. */
  private async storedImages(
    userId: string,
    chatId: string,
    messageId: string,
  ): Promise<ChatImage[]> {
    const message = await this.repo.messageOf(userId, chatId, messageId);
    const fileIds = (Array.isArray(message?.parts) ? (message.parts as unknown[]) : []).flatMap(
      (part) => {
        const parsed = chatPartSchema.safeParse(part);
        return parsed.success && parsed.data.type === "image" ? [parsed.data.fileId] : [];
      },
    );
    if (fileIds.length === 0) return [];
    try {
      return await this.images.load(userId, fileIds);
    } catch (error) {
      if (isAppError(error)) return [];
      throw error;
    }
  }
}
