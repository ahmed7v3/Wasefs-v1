import { Injectable } from "@nestjs/common";
import {
  AiProviderError,
  getSkill,
  type ChatMessage,
  type NormalizedMessage,
  type RouterEvent,
  type RouterInput,
  type RouterResult,
} from "@wasfa/ai";
import { AppError, ErrorCode, isAppError } from "@wasfa/shared/errors";
import { newId } from "@wasfa/shared/ids";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import {
  PLAYGROUND_RATE_LIMIT,
  type PlaygroundRequest,
  type PlaygroundResponse,
  type PlaygroundRun,
} from "@wasfa/shared/schemas/admin-ai";
import {
  rxExtractionJsonSchema,
  rxExtractionSchema,
  rxVerifyAnswerSchema,
  rxVerifyJsonSchema,
} from "@wasfa/shared/schemas/rx";

import { AiRuntimeService } from "../../ai-runtime/ai-runtime.service.js";
import { AuthRateLimiter } from "../../auth/rate-limiter.js";
import { ChatImages, type ChatImage } from "../../chat/chat-images.js";
import { CHAT_SYSTEM_PROMPT } from "../../chat/chat-prompts.js";

import { AdminAiPlaygroundRepo, type PlaygroundModel } from "./admin-ai-playground.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AiTask } from "@wasfa/shared/ai";
import type { z } from "zod";

/** Fields kept in the playground audit row: names and counts, never the input or the output. */
export const PLAYGROUND_AUDIT_FIELDS = ["task", "pictures", "runs"] as const;

const RUN_BUDGET_MS = 90_000;
const ATTEMPT_TIMEOUT_MS = 60_000;
const IMAGE_TOKENS = 1_500;
const MAX_OUTPUT_TOKENS: Partial<Record<AiTask, number>> = {
  rx_extract: 8_192,
  rx_verify: 4_096,
  deep_think: 8_192,
  chat: 4_096,
};
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;

const RX_SYSTEM =
  "You are the reading component of a pharmacy assistant. Follow the skill instructions below exactly. Reply with JSON that matches the provided schema and nothing else.";

/** The JSON tasks and the schema their answer must satisfy (the production schemas). */
interface JsonTask {
  name: "rx_extract" | "rx_verify";
  json: Record<string, unknown>;
  schema: z.ZodType;
}

const JSON_TASKS: Partial<Record<AiTask, JsonTask>> = {
  rx_extract: {
    name: "rx_extract",
    json: rxExtractionJsonSchema as unknown as Record<string, unknown>,
    schema: rxExtractionSchema,
  },
  rx_verify: {
    name: "rx_verify",
    json: rxVerifyJsonSchema as unknown as Record<string, unknown>,
    schema: rxVerifyAnswerSchema,
  },
};

function systemFor(task: AiTask): string | undefined {
  if (task === "rx_extract" || task === "rx_verify") {
    return `${RX_SYSTEM}\n\n${getSkill(RX_SKILL_NAME).body}`;
  }
  if (task === "chat" || task === "deep_think" || task === "web_search") return CHAT_SYSTEM_PROMPT;
  return undefined;
}

/** The input as one user message: text in a data block, then every picture in its own block. */
function messagesFor(input: string, images: readonly ChatImage[]): NormalizedMessage[] {
  const parts: ChatMessage["parts"] = [];
  if (input.trim() !== "") {
    parts.push({ type: "text", text: `<user_data>\n${input}\n</user_data>` });
  }
  images.forEach((image, index) => {
    parts.push(
      { type: "text", text: `<user_data picture="${String(index)}">` },
      { type: "image", mime: image.mime, data: image.data },
      { type: "text", text: "</user_data>" },
    );
  });
  return [{ role: "user", parts }];
}

function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

/** Field paths and issue codes only, like the production repair message. */
function validate(task: AiTask, output: string): PlaygroundRun["validation"] {
  const json = JSON_TASKS[task];
  if (!json) return { schema: null, ok: null, errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(unfence(output));
  } catch {
    return { schema: json.name, ok: false, errors: ["(root): not_json"] };
  }
  const parsed = json.schema.safeParse(value);
  if (parsed.success) return { schema: json.name, ok: true, errors: [] };
  return {
    schema: json.name,
    ok: false,
    errors: parsed.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`.slice(0, 200)),
  };
}

/** A short code of ours for whatever stopped a run; never a provider message. */
function failureOf(error: unknown): { status: "error" | "refused"; code: string } {
  if (isAppError(error)) {
    const reason = error.details?.["reason"];
    return { status: "refused", code: typeof reason === "string" ? reason : error.code };
  }
  if (error instanceof AiProviderError) return { status: "error", code: error.code };
  return { status: "error", code: "unknown" };
}

/**
 * Runs one input on up to three chosen models side by side (Task 2.4). Every run goes through the
 * real router (`runPinned`): kill switches, the global spend guard, the free-tier rule for medical
 * tasks, the breaker, and an `ai_usage` row per attempt. The prompt and the answer are returned to
 * the admin who sent them and are written nowhere else: not to the audit trail, not to a log.
 */
@Injectable()
export class AdminAiPlaygroundService {
  constructor(
    private readonly ai: AiRuntimeService,
    private readonly repo: AdminAiPlaygroundRepo,
    private readonly images: ChatImages,
    private readonly limiter: AuthRateLimiter,
  ) {}

  async run(
    actorId: string,
    input: PlaygroundRequest,
    audit: AuditScope,
  ): Promise<PlaygroundResponse> {
    const found = await this.repo.models(input.modelIds);
    const byId = new Map(found.map((model) => [model.id, model]));
    const models = input.modelIds.map((id) => byId.get(id));
    if (models.some((model) => model === undefined)) {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { reason: "model_missing" } });
    }
    const chosen = models.filter((model): model is PlaygroundModel => model !== undefined);

    // Pictures are checked before any provider is paid; a foreign or unfinished file stops here.
    const pictures = await this.images.load(actorId, input.fileIds);

    // One hit per run: three models cost three calls. Fails closed if Redis is down.
    for (let index = 0; index < chosen.length; index += 1) {
      await this.limiter.hit(
        `ai-playground:user:${actorId}`,
        PLAYGROUND_RATE_LIMIT.max,
        PLAYGROUND_RATE_LIMIT.windowSeconds,
      );
    }

    const budget = AbortSignal.timeout(RUN_BUDGET_MS);
    const runs = await Promise.all(
      chosen.map((model) => this.runOne(actorId, model, input, pictures, budget)),
    );

    audit.after = {
      task: input.task,
      pictures: pictures.length,
      runs: runs.map((run) => ({
        model: run.modelKey,
        status: run.status,
        input: run.usage?.inputTokens ?? 0,
        output: run.usage?.outputTokens ?? 0,
        thinking: run.usage?.thinkingTokens ?? 0,
        cost: run.costUsdMicros,
      })),
    };
    return { runs };
  }

  private async runOne(
    actorId: string,
    model: PlaygroundModel,
    input: PlaygroundRequest,
    pictures: readonly ChatImage[],
    signal: AbortSignal,
  ): Promise<PlaygroundRun> {
    const system = systemFor(input.task);
    const json = JSON_TASKS[input.task];
    const routerInput: RouterInput = {
      task: input.task,
      mode: input.task === "deep_think" ? "deep" : "balanced",
      planId: null,
      userId: actorId,
      requestId: `playground:${newId()}`,
      estimateInputTokens:
        Math.ceil((input.input.length + (system?.length ?? 0)) / 4) +
        pictures.length * IMAGE_TOKENS,
      attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
      request: {
        ...(system === undefined ? {} : { system }),
        messages: messagesFor(input.input, pictures),
        ...(json ? { jsonSchema: json.json } : {}),
        ...(input.task === "web_search" ? { search: true } : {}),
        maxOutputTokens: MAX_OUTPUT_TOKENS[input.task] ?? DEFAULT_MAX_OUTPUT_TOKENS,
      },
    };

    const startedAt = performance.now();
    let output = "";
    let result: RouterResult | undefined;
    const base = { modelId: model.id, modelKey: model.modelKey, providerKey: model.providerKey };
    const latency = () => Math.round(performance.now() - startedAt);
    try {
      result = await drain(this.ai.runPinned(model.id, routerInput, signal), (text) => {
        output += text;
      });
    } catch (error) {
      const failure = failureOf(error);
      return {
        ...base,
        status: failure.status,
        errorCode: failure.code,
        output,
        usage: null,
        costUsdMicros: 0,
        latencyMs: latency(),
        validation: { schema: json?.name ?? null, ok: json ? false : null, errors: [] },
      };
    }
    const usage = result?.usage;
    return {
      ...base,
      status: result?.outcome === "ok" ? "ok" : "error",
      errorCode: result?.outcome === "ok" ? null : "no_answer",
      output,
      usage: usage
        ? {
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            thinkingTokens: usage.thinkingTokens,
            searchCount: usage.searchCount,
          }
        : null,
      costUsdMicros: result?.totalCostUsdMicros ?? 0,
      latencyMs: latency(),
      validation: result?.outcome === "ok" ? validate(input.task, output) : emptyValidation(json),
    };
  }
}

function emptyValidation(json: JsonTask | undefined): PlaygroundRun["validation"] {
  return { schema: json?.name ?? null, ok: json ? false : null, errors: [] };
}

/** Drains the router stream, handing text to `onText`, and returns its final `result` event. */
async function drain(
  events: AsyncGenerator<RouterEvent>,
  onText: (text: string) => void,
): Promise<RouterResult | undefined> {
  let result: RouterResult | undefined;
  for await (const event of events) {
    if (event.type === "text") onText(event.text);
    else if (event.type === "result") result = event.result;
  }
  return result;
}
