import { z } from "zod";

import { usdPerTokenToMicrosPerM, usdToMicros } from "../pricing.js";

import { timedProbe, classifyUnknown } from "./errors.js";
import { getJson, joinUrl, streamChat } from "./openai-shared.js";

import type {
  AIProviderAdapter,
  ConnectionResult,
  DiscoveredModel,
  ModelPricing,
  NormalizedEvent,
  NormalizedRequest,
} from "../types.js";
import type { AiCapability, AiDataPolicy } from "@wasfa/shared/ai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouter uses these for app attribution on its public rankings.
const ATTRIBUTION_HEADERS = { "HTTP-Referer": "https://wasfa.online", "X-Title": "Wasfa AI" };

const modelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullish(),
      context_length: z.number().nullish(),
      architecture: z.object({ input_modalities: z.array(z.string()).nullish() }).nullish(),
      supported_parameters: z.array(z.string()).nullish(),
      pricing: z
        .object({
          prompt: z.string().nullish(),
          completion: z.string().nullish(),
          input_cache_read: z.string().nullish(),
          web_search: z.string().nullish(),
        })
        .nullish(),
    }),
  ),
});

type RawPricing = NonNullable<z.infer<typeof modelsSchema>["data"][number]["pricing"]>;

/** Optional price field: absent, empty or malformed (e.g. "-1" for variable pricing) means "not priced". */
function optionalMicros(
  value: string | null | undefined,
  convert: (s: string) => number,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return convert(value);
  } catch {
    return null;
  }
}

function toPricing(raw: RawPricing | null | undefined): ModelPricing | null {
  if (!raw) return null;
  const input = optionalMicros(raw.prompt, usdPerTokenToMicrosPerM);
  const output = optionalMicros(raw.completion, usdPerTokenToMicrosPerM);
  if (input === null || output === null) return null;
  return {
    inputUsdMicrosPerM: input,
    cachedInputUsdMicrosPerM: optionalMicros(raw.input_cache_read, usdPerTokenToMicrosPerM),
    outputUsdMicrosPerM: output,
    searchUsdMicros: optionalMicros(raw.web_search, usdToMicros),
  };
}

function providerRouting(dataPolicy: AiDataPolicy): Record<string, unknown> {
  return {
    data_collection: "deny",
    allow_fallbacks: true,
    ...(dataPolicy === "zdr" ? { zdr: true } : {}),
  };
}

function reasoningBody(req: NormalizedRequest): Record<string, unknown> | undefined {
  if (req.thinking === undefined) return undefined;
  if (req.thinking === "off") return { enabled: false };
  return { effort: req.thinking, exclude: req.includeThoughts !== true };
}

export class OpenRouterAdapter implements AIProviderAdapter {
  constructor(
    private readonly config: { baseUrl: string | null; apiKey: string; dataPolicy: AiDataPolicy },
    private readonly fetchFn: typeof fetch,
  ) {}

  private get baseUrl(): string {
    return this.config.baseUrl ?? OPENROUTER_BASE_URL;
  }

  stream(req: NormalizedRequest, signal: AbortSignal): AsyncGenerator<NormalizedEvent> {
    const reasoning = reasoningBody(req);
    return streamChat(
      {
        baseUrl: this.baseUrl,
        apiKey: this.config.apiKey,
        headers: ATTRIBUTION_HEADERS,
        flavor: "openrouter",
        fetch: this.fetchFn,
        req,
        extraBody: {
          provider: providerRouting(this.config.dataPolicy),
          ...(reasoning ? { reasoning } : {}),
          ...(req.search ? { plugins: [{ id: "web" }] } : {}),
        },
      },
      signal,
    );
  }

  async listModels(signal: AbortSignal): Promise<DiscoveredModel[]> {
    const json = await getJson(
      this.fetchFn,
      joinUrl(this.baseUrl, "/models"),
      this.config.apiKey,
      signal,
      ATTRIBUTION_HEADERS,
    );
    const parsed = modelsSchema.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data.data.map((model) => {
      const parameters = model.supported_parameters ?? [];
      const capabilities: AiCapability[] = [];
      if (model.architecture?.input_modalities?.includes("image")) capabilities.push("vision");
      if (parameters.includes("reasoning")) capabilities.push("thinking");
      if (parameters.includes("response_format") || parameters.includes("structured_outputs")) {
        capabilities.push("json");
      }
      return {
        id: model.id,
        displayName: model.name ?? null,
        contextTokens: model.context_length ?? null,
        capabilities,
        pricing: toPricing(model.pricing),
      };
    });
  }

  testConnection(signal: AbortSignal): Promise<ConnectionResult> {
    // /key validates the key itself, unlike /models which is public.
    return timedProbe(async () => {
      await getJson(
        this.fetchFn,
        joinUrl(this.baseUrl, "/key"),
        this.config.apiKey,
        signal,
        ATTRIBUTION_HEADERS,
      );
    }, classifyUnknown);
  }
}
