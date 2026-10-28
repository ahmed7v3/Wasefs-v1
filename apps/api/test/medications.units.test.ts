import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { settingDefault, type MedicationSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { ingredientValues } from "../src/admin/drugs/admin-drugs.service.js";
import { MedicationsService } from "../src/medications/medications.service.js";

import type { AuthRateLimiter } from "../src/auth/rate-limiter.js";
import type { MedicationsRepo } from "../src/medications/medications.repo.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { MedicationDetail, MedicationSummary } from "@wasfa/shared/schemas/medications";

/* The user medication API with fakes: feature switches, hidden prices, withdrawn entries, the per-user limit. */

const ID = "018f0000-0000-7000-8000-0000000000d1";
const USER = "018f0000-0000-7000-8000-0000000000a1";

const summary: MedicationSummary = {
  id: ID,
  brandEn: "Flumox 500mg",
  brandAr: null,
  brandKey: "flumox",
  form: "capsule",
  strengthText: "500 mg",
  packText: "20 caps",
  category: null,
  manufacturer: null,
  ingredients: ["Flucloxacillin"],
  priceMinor: 4250,
  currency: "EGP",
  priceUpdatedAt: "2026-10-01T00:00:00.000Z",
};
const detail: MedicationDetail = {
  ...summary,
  oldPriceMinor: 5000,
  unitsCount: 20,
  barcode: "6221000012345",
  status: "active",
  ingredientStrengths: [{ name: "Flucloxacillin", strength: "500 mg" }],
};

function setup(
  medications: Partial<MedicationSettings> = {},
  found: MedicationDetail | null = detail,
) {
  const hits: string[] = [];
  const repo = {
    search: () => Promise.resolve({ items: [summary], nextCursor: null }),
    find: () => Promise.resolve(found),
    alternatives: () => Promise.resolve([summary]),
  } as unknown as MedicationsRepo;
  const settings = {
    get: () => Promise.resolve({ ...settingDefault("medications"), ...medications }),
  } as unknown as SettingsService;
  const limiter = {
    hit: (key: string, max: number, seconds: number) => {
      hits.push(`${key}:${String(max)}:${String(seconds)}`);
      return Promise.resolve();
    },
  } as unknown as AuthRateLimiter;
  return { service: new MedicationsService(repo, settings, limiter), hits };
}

describe("MedicationsService", () => {
  it("searches with prices and limits each user to 60 a minute", async () => {
    const { service, hits } = setup();
    const page = await service.search(USER, { q: "flumox" });
    expect(page.items[0]?.priceMinor).toBe(4250);
    expect(hits).toEqual([`medications:user:${USER}:60:60`]);
  });

  it("answers NOT_FOUND (feature_off) when the database or its search is switched off", async () => {
    for (const medications of [
      { enabled: false },
      { search: { enabled: false, showPrices: true } },
    ]) {
      const { service, hits } = setup(medications);
      const failure = await service.search(USER, { q: "flumox" }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AppError);
      expect((failure as AppError).code).toBe(ErrorCode.NOT_FOUND);
      expect((failure as AppError).details).toMatchObject({ reason: "feature_off" });
      await expect(service.get(USER, ID)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(hits).toEqual([]);
    }
  });

  it("leaves every price out when showPrices is off", async () => {
    const { service } = setup({ search: { enabled: true, showPrices: false } });
    const page = await service.search(USER, { q: "flumox" });
    expect(page.items[0]).toMatchObject({ priceMinor: null, priceUpdatedAt: null });
    const one = await service.get(USER, ID);
    expect(one.medication).toMatchObject({
      priceMinor: null,
      oldPriceMinor: null,
      priceUpdatedAt: null,
    });
    expect(one.alternatives[0]).toMatchObject({ priceMinor: null });
  });

  it("returns the detail with its alternatives", async () => {
    const { service } = setup();
    const one = await service.get(USER, ID);
    expect(one.medication.barcode).toBe("6221000012345");
    expect(one.alternatives).toHaveLength(1);
  });

  it("does not show a missing or withdrawn entry", async () => {
    for (const found of [null, { ...detail, status: "withdrawn" as const }]) {
      const { service } = setup({}, found);
      await expect(service.get(USER, ID)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    }
  });
});

describe("ingredientValues (admin)", () => {
  it("normalizes the key and parses the strength", () => {
    expect(ingredientValues({ name: "  Amoxicillin  ", strength: "500 mg" })).toMatchObject({
      nameEn: "Amoxicillin",
      nameAr: null,
      normalized: "amoxicillin",
      strengthText: "500 mg",
      strengthValueMicro: 500_000_000,
      strengthUnit: "mg",
    });
  });

  it("keeps an Arabic name as the Arabic name and allows no strength", () => {
    expect(ingredientValues({ name: "باراسيتامول" })).toMatchObject({
      nameAr: "باراسيتامول",
      strengthText: null,
      strengthValueMicro: null,
    });
  });

  it("refuses a name that normalizes to nothing", () => {
    expect(() => ingredientValues({ name: "500 mg" })).toThrow(AppError);
  });
});
