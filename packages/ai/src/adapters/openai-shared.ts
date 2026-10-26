import { z } from "zod";

import { AiProviderError } from "../types.js";

import { abortable } from "./abortable.js";
import { classifyUnknown, codeForStatus, errorForStatus } from "./errors.js";

import type {
  ChatMessage,
  NormalizedEvent,
  NormalizedMessage,
  NormalizedRequest,
  ToolCall,
  ToolChoice,
  ToolDefinition,
  Usage,
} from "../types.js";

/**
 * Helpers shared by the OpenAI-compatible and OpenRouter adapters: request body, robust SSE
 * parsing and chunk -> event mapping. Provider text never reaches an error message.
 */

export type Flavor = "openrouter" | "compatible";

export interface ChatCall {
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  flavor: Flavor;
  fetch: typeof fetch;
  req: NormalizedRequest;
  /** Provider-specific body fields merged on top of the common ones. */
  extraBody?: Record<string, unknown>;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** Raw tool arguments kept in the error marker are cut here so a runaway model cannot bloat traces. */
const INVALID_ARGS_MAX_CHARS = 500;

/** Wire arguments are a JSON string; anything unparseable becomes a marker instead of an exception. */
export function parseToolArguments(raw: string): unknown {
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __invalid: raw.slice(0, INVALID_ARGS_MAX_CHARS) };
  }
}

function toWireArguments(args: unknown): string {
  const invalid =
    typeof args === "object" && args !== null && "__invalid" in (args as Record<string, unknown>);
  return invalid ? "{}" : JSON.stringify(args ?? {});
}

export function toWireTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export function toWireToolChoice(choice: ToolChoice): unknown {
  return typeof choice === "string"
    ? choice
    : { type: "function", function: { name: choice.name } };
}

function toWireMessage(message: NormalizedMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    return {
      role: "assistant",
      content: text === "" ? null : text,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: toWireArguments(call.arguments) },
      })),
    };
  }
  return toContent(message);
}

function toContent(message: ChatMessage): { role: string; content: unknown[] } {
  return {
    role: message.role,
    content: message.parts.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : {
            type: "image_url",
            image_url: {
              url: `data:${part.mime};base64,${Buffer.from(part.data).toString("base64")}`,
            },
          },
    ),
  };
}

/**
 * `schemaInPrompt`: for generic OpenAI-compatible servers. Many of them are gateways that forward
 * `response_format: json_schema` to another vendor (Gemini rejects `type: [x, "null"]`, for one), so
 * a strict schema fails the whole call with a permanent 400. Plain JSON mode works everywhere; the
 * schema travels as an instruction and the caller's zod check (plus one repair retry) enforces it.
 */
export function buildChatBody(
  req: NormalizedRequest,
  extra?: Record<string, unknown>,
  schemaInPrompt = false,
  tokenParam: "max_tokens" | "max_completion_tokens" = "max_tokens",
): Record<string, unknown> {
  const messages: unknown[] = [];
  const schemaNote =
    schemaInPrompt && req.jsonSchema
      ? `

Return only one JSON object that matches this JSON Schema, with no text before or after it:
${JSON.stringify(req.jsonSchema)}`
      : "";
  if (req.system !== undefined || schemaNote !== "") {
    messages.push({ role: "system", content: `${req.system ?? ""}${schemaNote}`.trimStart() });
  }
  for (const message of req.messages) messages.push(toWireMessage(message));

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    [tokenParam]: req.maxOutputTokens,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools && req.tools.length > 0) {
    body.tools = toWireTools(req.tools);
    if (req.toolChoice !== undefined) body.tool_choice = toWireToolChoice(req.toolChoice);
  }
  if (req.jsonSchema) {
    body.response_format = schemaInPrompt
      ? { type: "json_object" }
      : {
          type: "json_schema",
          json_schema: { name: "result", strict: true, schema: req.jsonSchema },
        };
  }
  return { ...body, ...extra };
}

/**
 * Server-sent events from a byte stream. Handles events split across network chunks, CRLF/CR/LF
 * line ends, `:` comment (keep-alive) lines and multi-line data; a final event without a trailing
 * blank line is still delivered. Yields each event's joined `data` payload.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  const takeLines = (final: boolean): string[] => {
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A trailing CR may be the first half of CRLF; wait for more bytes unless the stream ended.
      if (ch === "\r" && i === buffer.length - 1 && !final) break;
      lines.push(buffer.slice(start, i));
      if (ch === "\r" && buffer[i + 1] === "\n") i++;
      start = i + 1;
    }
    buffer = buffer.slice(start);
    return lines;
  };

  const consume = function* (lines: string[]): Generator<string> {
    for (const line of lines) {
      if (line === "") {
        if (data.length > 0) {
          yield data.join("\n");
          data = [];
        }
      } else if (line.startsWith(":")) {
        continue;
      } else if (line.startsWith("data:")) {
        const value = line.slice(5);
        data.push(value.startsWith(" ") ? value.slice(1) : value);
      }
      // `event:`, `id:` and `retry:` carry nothing we use.
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* consume(takeLines(false));
    }
    buffer += decoder.decode();
    yield* consume(takeLines(true));
    if (buffer !== "") yield* consume([buffer]);
    if (data.length > 0) yield data.join("\n");
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

const usageSchema = z.object({
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  prompt_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
  completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
  cost: z.number().nullish(),
});

const reasoningDetailSchema = z.object({
  type: z.string().nullish(),
  text: z.string().nullish(),
  summary: z.string().nullish(),
});

const annotationSchema = z.object({
  type: z.string().nullish(),
  url_citation: z.object({ url: z.string(), title: z.string().nullish() }).nullish(),
});

// Streamed tool calls arrive as fragments keyed by `index`: id and name first, arguments in pieces.
const toolCallDeltaSchema = z.object({
  index: z.number().nullish(),
  id: z.string().nullish(),
  function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
});

const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            reasoning: z.string().nullish(),
            reasoning_details: z.array(reasoningDetailSchema).nullish(),
            annotations: z.array(annotationSchema).nullish(),
            tool_calls: z.array(toolCallDeltaSchema).nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: usageSchema.nullish(),
  error: z.object({ code: z.union([z.number(), z.string()]).nullish() }).nullish(),
});

function mapFinishReason(reason: string): "stop" | "length" | "safety" | "other" {
  if (reason === "stop" || reason === "tool_calls") return "stop";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "safety";
  return "other";
}

function toUsage(raw: z.infer<typeof usageSchema>, searched: boolean): Usage {
  const reasoning = raw.completion_tokens_details?.reasoning_tokens ?? 0;
  const usage: Usage = {
    inputTokens: raw.prompt_tokens ?? 0,
    cachedInputTokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
    // completion_tokens includes reasoning; ours excludes it so pricing can add the two back once.
    outputTokens: Math.max(0, (raw.completion_tokens ?? 0) - reasoning),
    thinkingTokens: reasoning,
    searchCount: searched ? 1 : 0,
  };
  if (typeof raw.cost === "number") {
    // The only float -> integer boundary: OpenRouter reports cost as a USD number.
    usage.providerCostUsdMicros = Math.round(raw.cost * 1e6);
  }
  return usage;
}

/** Mid-stream `{"error":{"code":...}}` events carry a status-like code; only the code is used. */
function errorFromChunkCode(code: number | string | null | undefined): AiProviderError {
  const status = typeof code === "number" ? code : Number(code);
  return Number.isInteger(status) && status >= 400
    ? errorForStatus(status)
    : new AiProviderError("unknown");
}

/** POSTs a streaming chat completion and maps it to normalized events. Throws only AiProviderError. */
export async function* streamChat(
  call: ChatCall,
  signal: AbortSignal,
): AsyncGenerator<NormalizedEvent> {
  try {
    if (signal.aborted) throw new AiProviderError("timeout");
    const compatible = call.flavor === "compatible";
    const send = (tokenParam: "max_tokens" | "max_completion_tokens") =>
      call.fetch(joinUrl(call.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          ...call.headers,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${call.apiKey}`,
        },
        body: JSON.stringify(buildChatBody(call.req, call.extraBody, compatible, tokenParam)),
        signal,
      });
    // OpenAI's reasoning models (often behind a gateway) refuse `max_tokens`, while older servers
    // (Ollama, some vLLM builds) only know it. Generic servers start with the newer name and switch
    // once if the answer names the parameter; the other flavours keep `max_tokens`.
    let tokenParam: "max_tokens" | "max_completion_tokens" = compatible
      ? "max_completion_tokens"
      : "max_tokens";
    let response = await send(tokenParam);
    if (!response.ok && compatible && [400, 422, 500].includes(response.status)) {
      const detail = await response.text().catch(() => "");
      if (/max_completion_tokens|max_tokens/i.test(detail)) {
        tokenParam = tokenParam === "max_tokens" ? "max_completion_tokens" : "max_tokens";
        response = await send(tokenParam);
      }
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw errorForStatus(response.status);
    }
    if (!response.body) throw new AiProviderError("unavailable");

    const seenUrls = new Set<string>();
    let usage: z.infer<typeof usageSchema> | undefined;
    let finishReason: string | undefined;
    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const payload of abortable(parseSse(response.body), signal)) {
      if (signal.aborted) throw new AiProviderError("timeout");
      if (payload.trim() === "[DONE]") break;

      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const parsed = chunkSchema.safeParse(json);
      if (!parsed.success) continue;
      const chunk = parsed.data;
      if (chunk.error) throw errorFromChunkCode(chunk.error.code);

      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        if (delta) {
          if (call.flavor === "openrouter") {
            // OpenRouter sends the same reasoning twice (flat and detailed); take one.
            const details = (delta.reasoning_details ?? [])
              .map((detail) => detail.text ?? detail.summary ?? "")
              .join("");
            const thinking = delta.reasoning_details?.length ? details : (delta.reasoning ?? "");
            if (thinking) yield { type: "thinking", text: thinking };
          }
          if (delta.content) yield { type: "text", text: delta.content };
          for (const fragment of delta.tool_calls ?? []) {
            const index = fragment.index ?? 0;
            const pending = pendingCalls.get(index) ?? { id: "", name: "", args: "" };
            if (fragment.id) pending.id = fragment.id;
            if (fragment.function?.name) pending.name += fragment.function.name;
            if (fragment.function?.arguments) pending.args += fragment.function.arguments;
            pendingCalls.set(index, pending);
          }

          const sources: { url: string; title?: string }[] = [];
          for (const annotation of delta.annotations ?? []) {
            const citation =
              annotation.type === "url_citation" ? annotation.url_citation : undefined;
            if (!citation || seenUrls.has(citation.url)) continue;
            seenUrls.add(citation.url);
            sources.push(
              citation.title ? { url: citation.url, title: citation.title } : { url: citation.url },
            );
          }
          if (sources.length > 0) yield { type: "search", sources };
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      // The usage chunk arrives last and has empty `choices`.
      if (chunk.usage) usage = chunk.usage;
    }

    if (signal.aborted) throw new AiProviderError("timeout");
    const toolCalls: ToolCall[] = [...pendingCalls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, call]) => call.name !== "")
      .map(([index, call]) => ({
        // Some gateways omit ids; a stable one keeps the tool result pairable.
        id: call.id === "" ? `call_${String(index)}` : call.id,
        name: call.name,
        arguments: parseToolArguments(call.args),
      }));
    if (toolCalls.length > 0) yield { type: "tool_calls", toolCalls };
    if (usage) yield { type: "usage", usage: toUsage(usage, seenUrls.size > 0) };
    yield { type: "done", finishReason: finishReason ? mapFinishReason(finishReason) : "stop" };
  } catch (error) {
    throw error instanceof AiProviderError ? error : classifyUnknown(error);
  }
}

/** GET with bearer auth; returns parsed JSON or throws AiProviderError. */
export async function getJson(
  fetchFn: typeof fetch,
  url: string,
  apiKey: string,
  signal: AbortSignal,
  headers?: Record<string, string>,
): Promise<unknown> {
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: { ...headers, Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new AiProviderError(codeForStatus(response.status), response.status);
    }
    return await response.json();
  } catch (error) {
    throw error instanceof AiProviderError ? error : classifyUnknown(error);
  }
}
