import { settingDefault, type MedicationSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { AdminDrugsService } from "../src/admin/drugs/admin-drugs.service.js";

import type { AdminDrugsRepo } from "../src/admin/drugs/admin-drugs.repo.js";
import type { DrugMatcher } from "../src/drugs/matcher.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { DrugMatchCandidate } from "@wasfa/shared/drugs";

/* The admin recognition sandbox with fakes: settings reach the matcher, and the verdict is decideMatch's. */

const candidate = (overrides: Partial<DrugMatchCandidate> = {}): DrugMatchCandidate => ({
  drugId: "018f0000-0000-7000-8000-0000000000d1",
  brandEn: "Flumox 500mg",
  brandAr: null,
  form: "capsule",
  strengthText: "500 mg",
  manufacturer: null,
  status: "active",
  brandKey: "flumox",
  score: 0.95,
  explanation: { nameScore: 0.9, matchedOn: "brand", strength: "match", form: "unknown" },
  ...overrides,
});

function setup(found: DrugMatchCandidate[], medications: Partial<MedicationSettings> = {}) {
  const calls: { text: string; options: Record<string, unknown> }[] = [];
  const matcher = {
    matchDrug: (text: string, options: Record<string, unknown>) => {
      calls.push({ text, options });
      return Promise.resolve(found);
    },
  } as unknown as DrugMatcher;
  const settings = {
    get: () => Promise.resolve({ ...settingDefault("medications"), ...medications }),
  } as unknown as SettingsService;
  const service = new AdminDrugsService({} as AdminDrugsRepo, matcher, settings);
  return { service, calls };
}

describe("AdminDrugsService.sandbox", () => {
  it("passes the stored thresholds to the matcher and accepts a clear, strong match", async () => {
    const { service, calls } = setup([candidate()], {
      maxCandidates: 3,
      similarityFloor: 0.4,
      formBonus: 0.02,
    });
    const result = await service.sandbox({ q: "flumox", strength: "500 mg", legibility: "clear" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("flumox");
    expect(calls[0]?.options).toMatchObject({
      limit: 3,
      similarityFloor: 0.4,
      formBonus: 0.02,
      strength: { value: 500, unit: "mg" },
    });
    expect(result.decision).toEqual({
      matchClass: "accept",
      chosenDrugId: "018f0000-0000-7000-8000-0000000000d1",
      familyOnly: false,
      reason: "accepted",
    });
    expect(result.candidates[0]).toMatchObject({ brandEn: "Flumox 500mg", score: 0.95 });
    expect(result.settings).toMatchObject({ acceptScore: 0.85, reviewScore: 0.5, mode: "hybrid" });
  });

  it("asks for verification when the handwriting is unclear, with no chosen drug", async () => {
    const { service } = setup([candidate()]);
    const result = await service.sandbox({ q: "flumox", legibility: "unclear" });
    expect(result.decision).toMatchObject({
      matchClass: "verify",
      chosenDrugId: null,
      reason: "unclear_handwriting",
    });
  });

  it("is unmatched without candidates, and reports the engine switches", async () => {
    const { service } = setup([], { enabled: false, mode: "ai_only" });
    const result = await service.sandbox({ q: "zzz", legibility: "clear" });
    expect(result.candidates).toEqual([]);
    expect(result.decision).toMatchObject({ matchClass: "unmatched", reason: "no_candidates" });
    expect(result.settings).toMatchObject({ enabled: false, mode: "ai_only" });
  });
});
