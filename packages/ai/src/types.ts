import type { AiCapability, AiDataPolicy, AiProviderKind } from "@wasfa/shared/ai";

/** Provider-neutral request/response vocabulary. Adapters translate to and from it; nothing above them sees a provider shape. */

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";
export type MediaResolution = "low" | "medium" | "high" | "ultra_high";

export type MessagePart =
  { type: "text"; text: string } | { type: "image"; mime: string; data: Uint8Array };

/** A function the model may ask the caller to run. `name` follows `TOOL_NAME_PATTERN`. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments (an object schema). */
  parameters: Record<string, unknown>;
}

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** A tool call the model made. `arguments` is parsed JSON; unparseable wire JSON becomes `{ __invalid: raw }`. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
  /** Provider-owned opaque token (Gemini thought signature) that must be echoed back unchanged. */
  opaque?: string;
}

export type ToolChoice = "auto" | "none" | { name: string };

export interface ChatMessage {
  role: "user" | "assistant";
  parts: MessagePart[];
  /** Assistant turns only: the tool calls that turn made. */
  toolCalls?: ToolCall[];
}

/** The result of one tool call, answering the `ToolCall` with the same id. */
export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
}

export type NormalizedMessage = ChatMessage | ToolResultMessage;

export interface NormalizedRequest {
  /** The provider's own model id (free text, discovered live). */
  model: string;
  system?: string;
  messages: NormalizedMessage[];
  /** JSON schema for structured output. */
  jsonSchema?: Record<string, unknown>;
  thinking?: ThinkingLevel;
  includeThoughts?: boolean;
  mediaResolution?: MediaResolution;
  search?: boolean;
  /** Tool calling (non-streaming agents). Search is never sent together with tools. */
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  maxOutputTokens: number;
  temperature?: number;
}

/**
 * Token counts. `inputTokens` is the provider's TOTAL prompt count (cached included);
 * `outputTokens` excludes thinking tokens, which are counted separately. Pricing does the split.
 */
export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  searchCount: number;
  /** What the provider itself billed (OpenRouter `usage.cost`), integer USD micros. */
  providerCostUsdMicros?: number;
}

export type NormalizedEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "search"; sources: { url: string; title?: string }[] }
  | { type: "tool_calls"; toolCalls: ToolCall[] }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: "stop" | "length" | "safety" | "other" };

/** One finished model call with the stream collected: what a non-streaming caller sees. */
export interface CompletionResult {
  text: string;
  /** Possibly empty. */
  toolCalls: ToolCall[];
  usage: Usage | undefined;
  /** Provider cost of the call, failed fallback attempts included. Integer USD micros. */
  costUsdMicros: number;
  finishReason: "stop" | "length" | "safety" | "other";
}

export const AI_ERROR_CODES = [
  "auth",
  "rate_limited",
  "timeout",
  "unavailable",
  "bad_request",
  "content_blocked",
  "not_found",
  "unknown",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["rate_limited", "timeout", "unavailable"]);

/**
 * The only error adapters throw. The message is OUR generic text: provider bodies can echo prompts
 * or keys, so they never reach `message`, `cause` or logs.
 */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(code: AiErrorCode, status?: number) {
    super(`AI provider error: ${code}`);
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    if (status !== undefined) this.status = status;
  }
}

/** Prices in integer USD micros per 1M tokens (so $0.75/1M = 750000). */
export interface ModelPricing {
  inputUsdMicrosPerM: number;
  cachedInputUsdMicrosPerM: number | null;
  outputUsdMicrosPerM: number;
  /** USD micros per search call. */
  searchUsdMicros: number | null;
}

export interface DiscoveredModel {
  id: string;
  displayName: string | null;
  contextTokens: number | null;
  capabilities: AiCapability[];
  pricing: ModelPricing | null;
}

export interface ConnectionResult {
  ok: boolean;
  latencyMs: number;
  errorCode?: AiErrorCode;
}

export interface ProviderConfig {
  kind: AiProviderKind;
  baseUrl: string | null;
  apiKey: string | null;
  dataPolicy: AiDataPolicy;
}

export interface AIProviderAdapter {
  stream(req: NormalizedRequest, signal: AbortSignal): AsyncIterable<NormalizedEvent>;
  listModels(signal: AbortSignal): Promise<DiscoveredModel[]>;
  /** Never throws; maps errors to `errorCode`. */
  testConnection(signal: AbortSignal): Promise<ConnectionResult>;
}
