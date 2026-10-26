// The ONLY file that imports @google/genai: everything above it sees NormalizedRequest/Event only.
import {
  ApiError,
  FunctionCallingConfigMode,
  GoogleGenAI,
  MediaResolution as GeminiMediaResolution,
  ThinkingLevel as GeminiThinkingLevel,
} from "@google/genai";

import { AiProviderError } from "../types.js";

import { abortable } from "./abortable.js";
import { classifyUnknown, errorForStatus, timedProbe } from "./errors.js";

import type {
  AIProviderAdapter,
  ChatMessage,
  ConnectionResult,
  DiscoveredModel,
  MediaResolution,
  NormalizedEvent,
  NormalizedMessage,
  NormalizedRequest,
  ThinkingLevel,
  ToolCall,
  ToolChoice,
  Usage,
} from "../types.js";
import type {
  Content,
  GenerateContentConfig,
  FunctionCallingConfig,
  GenerateContentResponse,
  Part,
  ThinkingConfig,
} from "@google/genai";
import type { AiCapability } from "@wasfa/shared/ai";

const PAGE_SIZE = 1000;

const THINKING_LEVELS: Record<Exclude<ThinkingLevel, "off">, GeminiThinkingLevel> = {
  minimal: GeminiThinkingLevel.MINIMAL,
  low: GeminiThinkingLevel.LOW,
  medium: GeminiThinkingLevel.MEDIUM,
  high: GeminiThinkingLevel.HIGH,
};

// SDK 2.28 has no ultra-high media resolution value, so ultra_high degrades to the highest it knows.
const MEDIA_RESOLUTIONS: Record<MediaResolution, GeminiMediaResolution> = {
  low: GeminiMediaResolution.MEDIA_RESOLUTION_LOW,
  medium: GeminiMediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: GeminiMediaResolution.MEDIA_RESOLUTION_HIGH,
  ultra_high: GeminiMediaResolution.MEDIA_RESOLUTION_HIGH,
};

const SAFETY_FINISH_REASONS: ReadonlySet<string> = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
]);

function mapFinishReason(reason: string | undefined): "stop" | "length" | "safety" | "other" {
  if (reason === undefined || reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "length";
  if (SAFETY_FINISH_REASONS.has(reason)) return "safety";
  return "other";
}

function toParts(message: ChatMessage): Part[] {
  return message.parts.map((part): Part =>
    part.type === "text"
      ? { text: part.text }
      : { inlineData: { mimeType: part.mime, data: Buffer.from(part.data).toString("base64") } },
  );
}

/** Gemini wants an object as a function response; tool content is JSON text from our loop. */
function toFunctionResponse(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

function toFunctionCallPart(call: ToolCall): Part {
  const args =
    typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments)
      ? (call.arguments as Record<string, unknown>)
      : {};
  return {
    functionCall: { id: call.id, name: call.name, args },
    ...(call.opaque === undefined ? {} : { thoughtSignature: call.opaque }),
  };
}

/** History to Gemini contents: tool results become one user turn per run of results (parallel calls). */
export function toContents(messages: NormalizedMessage[]): Content[] {
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const part: Part = {
        functionResponse: {
          id: message.toolCallId,
          name: message.name,
          response: toFunctionResponse(message.content),
        },
      };
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts?.every((p) => p.functionResponse !== undefined)) {
        last.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }
    const parts = toParts(message);
    for (const call of message.toolCalls ?? []) parts.push(toFunctionCallPart(call));
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return contents;
}

function toFunctionCallingConfig(choice: ToolChoice): FunctionCallingConfig {
  if (choice === "auto") return { mode: FunctionCallingConfigMode.AUTO };
  if (choice === "none") return { mode: FunctionCallingConfigMode.NONE };
  return { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [choice.name] };
}

function toThinkingConfig(req: NormalizedRequest): ThinkingConfig | undefined {
  if (req.thinking === undefined) return undefined;
  // Budget and level are mutually exclusive in the API: "off" is a zero budget, anything else a level.
  if (req.thinking === "off") return { thinkingBudget: 0 };
  return {
    thinkingLevel: THINKING_LEVELS[req.thinking],
    includeThoughts: req.includeThoughts ?? false,
  };
}

function buildConfig(req: NormalizedRequest, signal: AbortSignal): GenerateContentConfig {
  const config: GenerateContentConfig = {
    maxOutputTokens: req.maxOutputTokens,
    abortSignal: signal,
  };
  if (req.system !== undefined) config.systemInstruction = req.system;
  if (req.temperature !== undefined) config.temperature = req.temperature;
  const thinkingConfig = toThinkingConfig(req);
  if (thinkingConfig) config.thinkingConfig = thinkingConfig;
  if (req.mediaResolution) config.mediaResolution = MEDIA_RESOLUTIONS[req.mediaResolution];
  if (req.jsonSchema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = req.jsonSchema;
  }
  if (req.tools && req.tools.length > 0) {
    // googleSearch is deliberately not sent next to function declarations (tools win).
    config.tools = [
      {
        functionDeclarations: req.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })),
      },
    ];
    if (req.toolChoice !== undefined) {
      config.toolConfig = { functionCallingConfig: toFunctionCallingConfig(req.toolChoice) };
    }
  } else if (req.search) {
    config.tools = [{ googleSearch: {} }];
  }
  return config;
}

function mapError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof ApiError) return errorForStatus(error.status);
  return classifyUnknown(error);
}

function toUsage(
  metadata: NonNullable<GenerateContentResponse["usageMetadata"]>,
  searched: boolean,
): Usage {
  return {
    inputTokens: metadata.promptTokenCount ?? 0,
    cachedInputTokens: metadata.cachedContentTokenCount ?? 0,
    // Gemini reports thinking separately from candidates, matching how pricing adds them back.
    outputTokens: metadata.candidatesTokenCount ?? 0,
    thinkingTokens: metadata.thoughtsTokenCount ?? 0,
    searchCount: searched ? 1 : 0,
  };
}

export class GeminiAdapter implements AIProviderAdapter {
  private readonly client: GoogleGenAI;

  constructor(config: { apiKey: string; baseUrl: string | null }) {
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { httpOptions: { baseUrl: config.baseUrl } } : {}),
    });
  }

  async *stream(req: NormalizedRequest, signal: AbortSignal): AsyncGenerator<NormalizedEvent> {
    const contents = toContents(req.messages);

    try {
      if (signal.aborted) throw new AiProviderError("timeout");
      const chunks = await this.client.models.generateContentStream({
        model: req.model,
        contents,
        config: buildConfig(req, signal),
      });

      const seenUrls = new Set<string>();
      let searched = false;
      let usage: Usage | undefined;
      let finishReason: string | undefined;
      const toolCalls: ToolCall[] = [];

      for await (const chunk of abortable(chunks, signal)) {
        if (signal.aborted) throw new AiProviderError("timeout");
        if (chunk.promptFeedback?.blockReason) throw new AiProviderError("content_blocked");

        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.functionCall?.name) {
            const call = part.functionCall;
            toolCalls.push({
              // Gemini often sends no id; a positional one keeps results pairable.
              id: call.id ?? `call_${String(toolCalls.length)}`,
              name: call.name ?? "",
              arguments: call.args ?? {},
              ...(part.thoughtSignature === undefined ? {} : { opaque: part.thoughtSignature }),
            });
            continue;
          }
          if (!part.text) continue;
          yield part.thought === true
            ? { type: "thinking", text: part.text }
            : { type: "text", text: part.text };
        }

        const grounding = candidate?.groundingMetadata;
        if (grounding) {
          searched = true;
          const sources: { url: string; title?: string }[] = [];
          for (const groundingChunk of grounding.groundingChunks ?? []) {
            const web = groundingChunk.web;
            if (!web?.uri || seenUrls.has(web.uri)) continue;
            seenUrls.add(web.uri);
            sources.push(web.title ? { url: web.uri, title: web.title } : { url: web.uri });
          }
          if (sources.length > 0) yield { type: "search", sources };
        }

        if (candidate?.finishReason) finishReason = candidate.finishReason;
        if (chunk.usageMetadata) usage = toUsage(chunk.usageMetadata, searched);
      }

      if (signal.aborted) throw new AiProviderError("timeout");
      if (toolCalls.length > 0) yield { type: "tool_calls", toolCalls };
      // Usage is cumulative across chunks; only the last figure counts, and only if the provider sent one.
      if (usage) yield { type: "usage", usage: { ...usage, searchCount: searched ? 1 : 0 } };
      yield { type: "done", finishReason: mapFinishReason(finishReason) };
    } catch (error) {
      throw mapError(error);
    }
  }

  async listModels(signal: AbortSignal): Promise<DiscoveredModel[]> {
    try {
      const pager = await this.client.models.list({
        config: { pageSize: PAGE_SIZE, abortSignal: signal },
      });
      const models: DiscoveredModel[] = [];
      for await (const model of pager) {
        // The SDK maps the REST field supportedGenerationMethods onto supportedActions.
        if (!model.name || !model.supportedActions?.includes("generateContent")) continue;
        const id = model.name.replace(/^models\//, "");
        const capabilities: AiCapability[] = ["vision"];
        if (model.thinking) capabilities.push("thinking");
        if (id.startsWith("gemini-")) capabilities.push("search");
        capabilities.push("json");
        models.push({
          id,
          displayName: model.displayName ?? null,
          contextTokens: model.inputTokenLimit ?? null,
          capabilities,
          // The Gemini API does not publish prices; they are entered manually.
          pricing: null,
        });
      }
      return models;
    } catch (error) {
      throw mapError(error);
    }
  }

  testConnection(signal: AbortSignal): Promise<ConnectionResult> {
    return timedProbe(async () => {
      await this.client.models.list({ config: { pageSize: 1, abortSignal: signal } });
    }, mapError);
  }
}
