import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { buildSystemPrompt, MEDICATIONS_GUIDE } from "../src/wa-agent/agent/agent-prompt.js";
import {
  bindTools,
  toolsFor,
  type AgentToolContext,
  type ToolCallRecord,
} from "../src/wa-agent/agent/tools/index.js";

import { COMMERCE_CONVERSATION_ID, unusedCommerceDeps } from "./support/wa-agent-commerce-fakes.js";

import type { MedicationSummary } from "@wasfa/shared/schemas/medications";

/* `search_medications` and `medication_alternatives` with a fake medication port. */

const NOW = new Date("2026-10-28T10:00:00.000Z");
const DRUG_ID = "018f0000-0000-7000-8000-0000000000d1";

const summary = (overrides: Partial<MedicationSummary> = {}): MedicationSummary => ({
  id: DRUG_ID,
  brandEn: "Flumox 500mg 20 caps",
  brandAr: null,
  brandKey: "flumox",
  form: "capsule",
  strengthText: "500 mg",
  packText: "20 caps",
  category: "Antibiotics",
  manufacturer: "Amoun",
  ingredients: ["Flucloxacillin"],
  priceMinor: 4250,
  currency: "EGP",
  priceUpdatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

function setup(userId: string | null, options: { showPrices?: boolean } = {}) {
  const searches: { query: string; limit: number }[] = [];
  const lookups: { drugId: string; limit: number }[] = [];
  const ctx: AgentToolContext = {
    conversationId: COMMERCE_CONVERSATION_ID,
    userId,
    market: { currency: "EGP", country: "EG" },
    config: settingDefault("waAgent"),
    now: NOW,
    mediaParts: [],
    handoffReason: null,
    deps: {
      catalog: { catalog: () => Promise.reject(new Error("unused")) },
      account: { status: () => Promise.reject(new Error("unused")) },
      media: { find: () => Promise.resolve(null) },
      mediaOrigin: "",
      handoff: { raise: () => Promise.resolve() },
      ...unusedCommerceDeps,
      medications: {
        search: (query, limit) => {
          searches.push({ query, limit });
          return Promise.resolve([summary()]);
        },
        alternatives: (drugId, limit) => {
          lookups.push({ drugId, limit });
          return Promise.resolve([
            summary({ id: "018f0000-0000-7000-8000-0000000000d2", priceMinor: null }),
          ]);
        },
        showPrices: () => Promise.resolve(options.showPrices ?? true),
      },
    },
  };
  const records: ToolCallRecord[] = [];
  const { handlers } = bindTools(toolsFor(userId !== null, { medications: true }), ctx, records);
  return { handlers, searches, lookups, records };
}

describe("medication tools registry", () => {
  const names = (linked: boolean, medications?: boolean) =>
    toolsFor(linked, medications === undefined ? {} : { medications }).map(
      (tool) => tool.definition.name,
    );

  it("are offered to guests and linked chats while the switch is on", () => {
    for (const linked of [false, true]) {
      expect(names(linked, true)).toEqual(
        expect.arrayContaining(["search_medications", "medication_alternatives"]),
      );
    }
  });

  it("are not offered when the switch is off or unspecified", () => {
    for (const linked of [false, true]) {
      expect(names(linked, false)).not.toContain("search_medications");
      expect(names(linked)).not.toContain("medication_alternatives");
    }
  });

  it("are described to the model only while on", () => {
    const input = {
      persona: "",
      language: "ar" as const,
      emojiLevel: "none" as const,
      now: NOW,
      firstName: null,
      currency: "EGP",
      summary: null,
    };
    expect(buildSystemPrompt({ ...input, medications: true })).toContain(MEDICATIONS_GUIDE);
    expect(buildSystemPrompt(input)).not.toContain(MEDICATIONS_GUIDE);
  });
});

describe("search_medications", () => {
  it("returns up to 5 entries with the approximate price for a guest", async () => {
    const { handlers, searches, records } = setup(null);
    const result = await handlers["search_medications"]?.({ query: "  flumox " });
    expect(searches).toEqual([{ query: "flumox", limit: 5 }]);
    expect(result).toMatchObject({
      count: 1,
      medications: [
        {
          id: DRUG_ID,
          brand: "Flumox 500mg 20 caps",
          ingredients: ["Flucloxacillin"],
          strength: "500 mg",
          form: "capsule",
          pack: "20 caps",
          approximatePrice: { amountMinor: 4250, currency: "EGP" },
        },
      ],
    });
    expect(records).toEqual([{ name: "search_medications", ok: true }]);
  });

  it("leaves prices out when the admin hides them", async () => {
    const { handlers } = setup(null, { showPrices: false });
    const result = (await handlers["search_medications"]?.({ query: "flumox" })) as {
      medications: Record<string, unknown>[];
    };
    expect(result.medications[0]).not.toHaveProperty("approximatePrice");
  });

  it("refuses arguments that do not fit", async () => {
    const { handlers, searches } = setup(null);
    expect(await handlers["search_medications"]?.({ query: "" })).toEqual({
      error: "invalid_arguments",
    });
    expect(await handlers["search_medications"]?.({ query: "x".repeat(81) })).toEqual({
      error: "invalid_arguments",
    });
    expect(searches).toHaveLength(0);
  });
});

describe("medication_alternatives", () => {
  it("returns up to 5 alternatives for a linked chat, an unpriced one without a price", async () => {
    const { handlers, lookups } = setup("018f0000-0000-7000-8000-0000000000a1");
    const result = (await handlers["medication_alternatives"]?.({ drugId: DRUG_ID })) as {
      count: number;
      alternatives: Record<string, unknown>[];
    };
    expect(lookups).toEqual([{ drugId: DRUG_ID, limit: 5 }]);
    expect(result.count).toBe(1);
    expect(result.alternatives[0]).not.toHaveProperty("approximatePrice");
  });

  it("works for a guest and rejects a bad id", async () => {
    const { handlers, lookups } = setup(null);
    expect(await handlers["medication_alternatives"]?.({ drugId: "nope" })).toEqual({
      error: "invalid_arguments",
    });
    expect(lookups).toHaveLength(0);
    expect(await handlers["medication_alternatives"]?.({ drugId: DRUG_ID })).toMatchObject({
      count: 1,
    });
  });
});
