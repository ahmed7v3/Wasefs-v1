import { z } from "zod";

import { classifyUnknown, timedProbe } from "./errors.js";
import { getJson, joinUrl, streamChat } from "./openai-shared.js";

import type {
  AIProviderAdapter,
  ConnectionResult,
  DiscoveredModel,
  NormalizedEvent,
  NormalizedRequest,
} from "../types.js";

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/** Any server speaking the OpenAI chat-completions dialect (vLLM, Ollama, LiteLLM, ...). */
export class OpenAiCompatibleAdapter implements AIProviderAdapter {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetchFn: typeof fetch,
  ) {}

  stream(req: NormalizedRequest, signal: AbortSignal): AsyncGenerator<NormalizedEvent> {
    return streamChat(
      {
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        flavor: "compatible",
        fetch: this.fetchFn,
        req,
      },
      signal,
    );
  }

  async listModels(signal: AbortSignal): Promise<DiscoveredModel[]> {
    const json = await getJson(
      this.fetchFn,
      joinUrl(this.config.baseUrl, "/models"),
      this.config.apiKey,
      signal,
    );
    const parsed = modelsSchema.safeParse(json);
    if (!parsed.success) return [];
    // The dialect publishes ids only: capabilities and prices are entered manually.
    return parsed.data.data.map((model) => ({
      id: model.id,
      displayName: null,
      contextTokens: null,
      capabilities: [],
      pricing: null,
    }));
  }

  testConnection(signal: AbortSignal): Promise<ConnectionResult> {
    return timedProbe(async () => {
      await getJson(
        this.fetchFn,
        joinUrl(this.config.baseUrl, "/models"),
        this.config.apiKey,
        signal,
      );
    }, classifyUnknown);
  }
}
