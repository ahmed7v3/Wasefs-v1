import { describe, expect, it } from "vitest";

import {
  MODEL_ID_PATTERN,
  createProviderSchema,
  putAiSettingsSchema,
  routeModelsSchema,
  updateProviderSchema,
} from "../src/schemas/admin-ai.js";

const ID_A = "018f0000-0000-7000-8000-000000000001";
const ID_B = "018f0000-0000-7000-8000-000000000002";

describe("MODEL_ID_PATTERN", () => {
  it("accepts provider model ids as they come", () => {
    for (const id of ["gemini-3.8-flash", "google/gemini-3.8-flash", "llama3:8b", "a@b+c_d"]) {
      expect(MODEL_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it("refuses spaces, a leading symbol and over-long ids", () => {
    for (const id of ["", "has space", "-lead", "/lead", "x".repeat(201)]) {
      expect(MODEL_ID_PATTERN.test(id), id).toBe(false);
    }
  });
});

describe("routeModelsSchema", () => {
  const entry = (modelId: string, params: Record<string, unknown> = {}) => ({ modelId, params });

  it("takes one to six distinct models with known params", () => {
    expect(
      routeModelsSchema.safeParse([entry(ID_A, { thinking: "low", search: true })]).success,
    ).toBe(true);
    expect(routeModelsSchema.safeParse([]).success).toBe(false);
    expect(routeModelsSchema.safeParse([entry(ID_A), entry(ID_A)]).success).toBe(false);
    expect(routeModelsSchema.safeParse([entry(ID_A, { tool: "google_search" })]).success).toBe(
      false,
    );
    expect(routeModelsSchema.safeParse([entry(ID_A, { temperature: 2.5 })]).success).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) =>
      entry(`018f0000-0000-7000-8000-00000000010${String(i)}`),
    );
    expect(routeModelsSchema.safeParse(seven).success).toBe(false);
    expect(routeModelsSchema.safeParse([entry(ID_A), entry(ID_B)]).success).toBe(true);
  });
});

describe("providers", () => {
  it("needs a base URL for an OpenAI-compatible provider and a key of 8+ characters", () => {
    const base = { key: "my_provider", kind: "openai_compatible", dataPolicy: "zdr" };
    expect(createProviderSchema.safeParse(base).success).toBe(false);
    expect(
      createProviderSchema.safeParse({ ...base, baseUrl: "https://x.example/v1" }).success,
    ).toBe(true);
    expect(
      createProviderSchema.safeParse({ ...base, baseUrl: "https://x.example/v1", apiKey: "short" })
        .success,
    ).toBe(false);
  });

  it("does not take a key and clearKey together", () => {
    expect(updateProviderSchema.safeParse({ apiKey: "12345678", clearKey: true }).success).toBe(
      false,
    );
    expect(updateProviderSchema.safeParse({ clearKey: true }).success).toBe(true);
    expect(updateProviderSchema.safeParse({}).success).toBe(false);
  });
});

describe("putAiSettingsSchema", () => {
  const full = {
    dailyCapUsdMicros: 5_000_000,
    alertPercent: 80,
    killSwitch: { all: false, rx: false, chat: false, search: false },
    creditValueUsdMicros: 10_000,
    allowPreviewModels: false,
  };

  it("requires every field: a partial write must not reset the cap or a kill switch", () => {
    expect(putAiSettingsSchema.safeParse(full).success).toBe(true);
    expect(putAiSettingsSchema.safeParse({}).success).toBe(false);
    expect(putAiSettingsSchema.safeParse({ ...full, killSwitch: { all: true } }).success).toBe(
      false,
    );
    expect(putAiSettingsSchema.safeParse({ ...full, alertPercent: 0 }).success).toBe(false);
  });
});
