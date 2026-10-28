import { settingDefault, type MedicationSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { buildPrompt } from "../src/chat/chat-context.js";
import {
  ChatMedicationCards,
  MEDICATION_REFERENCE_HEADER,
  formatMedicationReference,
} from "../src/chat/chat-medications.js";

import type { DbHandle } from "../src/common/database.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { MedicationCard } from "@wasfa/shared/schemas/medications";
import type { PinoLogger } from "nestjs-pino";

/*
 * Reference cards for the website assistant: the formatter (pure), the "no cards, prompt unchanged"
 * path, the switches and the promise that a database failure never breaks a chat turn.
 */

const brand: MedicationCard = {
  kind: "brand",
  title: "Flumox",
  ingredients: ["Amoxicillin", "Flucloxacillin"],
  strengths: ["250 mg", "500 mg"],
  forms: ["capsule"],
  category: "Antibiotics",
  priceMinMinor: 1250,
  priceMaxMinor: 4000,
  currency: "EGP",
};
const ingredient: MedicationCard = {
  kind: "ingredient",
  title: "Paracetamol",
  ingredients: ["Paracetamol"],
  strengths: [],
  forms: [],
  category: null,
  priceMinMinor: 500,
  priceMaxMinor: 500,
  currency: "EGP",
};

describe("formatMedicationReference", () => {
  it("is null without cards", () => {
    expect(formatMedicationReference([], true)).toBeNull();
  });

  it("lists one compact line per card under the header, with a price range in the currency", () => {
    const text = formatMedicationReference([brand, ingredient], true);
    expect(text?.startsWith(MEDICATION_REFERENCE_HEADER)).toBe(true);
    const lines = (text ?? "").split("\n").filter((line) => line.startsWith("- "));
    expect(lines).toEqual([
      "- brand: Flumox; contains Amoxicillin + Flucloxacillin; strengths 250 mg, 500 mg; forms capsule; category Antibiotics; price 12.50-40.00 EGP",
      "- active ingredient: Paracetamol; price 5.00 EGP",
    ]);
  });

  it("leaves prices out when the admin hides them", () => {
    const text = formatMedicationReference([brand, ingredient], false) ?? "";
    expect(text).not.toContain("; price ");
    expect(text).not.toContain("EGP");
  });
});

describe("buildPrompt with a medication reference", () => {
  const base = {
    systemPrompt: "SYSTEM",
    skillBody: null,
    summary: null,
    history: [],
    userText: "hello",
    images: [],
  };

  it("is unchanged without a reference", () => {
    const plain = buildPrompt(base);
    expect(buildPrompt({ ...base, medicationReference: null }).system).toBe(plain.system);
    expect(plain.system).toBe("SYSTEM");
  });

  it("adds exactly one block after the system prompt and counts it in the input size", () => {
    const reference = formatMedicationReference([brand], true) ?? "";
    const built = buildPrompt({ ...base, medicationReference: reference });
    expect(built.system).toBe(`SYSTEM\n\n${reference}`);
    expect(built.inputChars).toBeGreaterThan(buildPrompt(base).inputChars);
  });
});

describe("ChatMedicationCards", () => {
  function setup(medications: Partial<MedicationSettings>, execute: () => Promise<unknown[]>) {
    const calls = { execute: 0, warn: 0 };
    const handle = {
      db: {
        execute: () => {
          calls.execute += 1;
          return execute();
        },
      },
    } as unknown as DbHandle;
    const settings = {
      get: () => Promise.resolve({ ...settingDefault("medications"), ...medications }),
    } as unknown as SettingsService;
    const logger = {
      setContext: () => undefined,
      warn: () => {
        calls.warn += 1;
      },
    } as unknown as PinoLogger;
    return { cards: new ChatMedicationCards(handle, settings, logger), calls };
  }

  it("answers null when no medicine is named", async () => {
    const { cards, calls } = setup({}, () => Promise.resolve([]));
    expect(await cards.blockFor("Panadol")).toBeNull();
    expect(calls.execute).toBe(3);
    expect(await cards.blockFor("how are you")).toBeNull();
  });

  it("does not query when the database or the cards are switched off", async () => {
    for (const medications of [
      { enabled: false },
      { chatCards: { enabled: false, max: 3 } },
      { chatCards: { enabled: true, max: 0 } },
    ] satisfies Partial<MedicationSettings>[]) {
      const { cards, calls } = setup(medications, () => Promise.resolve([]));
      expect(await cards.blockFor("Panadol")).toBeNull();
      expect(calls.execute).toBe(0);
    }
  });

  it("logs and continues without cards when the database fails", async () => {
    const { cards, calls } = setup({}, () => Promise.reject(new Error("db down")));
    expect(await cards.blockFor("Panadol")).toBeNull();
    expect(calls.warn).toBe(1);
  });
});
