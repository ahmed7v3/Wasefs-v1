import { describe, expect, it } from "vitest";

import {
  DEFAULT_BANNED_CLAIMS,
  DEFAULT_PROMPT_CATALOG,
  findBannedClaim,
  promptCatalogSchema,
  promptEntrySchema,
  renderPromptText,
  resolvePromptCatalog,
} from "../src/growth-prompts.js";
import { GROWTH_PROMPT_KINDS, MODAL_PROMPT_KINDS, isCalmSurface, modalAllowed } from "../src/growth.js";
import { SETTINGS_REGISTRY, settingDefault } from "../src/settings.js";

const growthSchema = SETTINGS_REGISTRY.growth.schema;

describe("catalog defaults", () => {
  it("has a valid entry for every prompt kind, modal only for the calm ones", () => {
    const catalog = resolvePromptCatalog({});
    for (const kind of GROWTH_PROMPT_KINDS) {
      expect(promptEntrySchema.safeParse(DEFAULT_PROMPT_CATALOG[kind]).success, kind).toBe(true);
      expect(catalog[kind].form === "modal", kind).toBe(modalAllowed(kind));
    }
    expect([...MODAL_PROMPT_KINDS].sort()).toEqual(["credits_out", "trial_ended"]);
  });

  it("keeps stored settings that predate the catalog parsing", () => {
    const old = growthSchema.parse({
      prompts: { enabled: true, cooldownDays: 7, maxCooldownDays: 60, maxPerSession: 1 },
    });
    expect(old.prompts.catalog).toEqual({});
    expect(old.bannedClaims).toEqual([...DEFAULT_BANNED_CLAIMS]);
    expect(settingDefault("growth").prompts.catalog).toEqual({});
  });

  it("passes its own claims lint (with the deep pair allowed only on a deep plan)", () => {
    for (const entry of Object.values(resolvePromptCatalog({}))) {
      const texts = Object.values(entry.copy).flatMap((copy) => [copy.title, copy.body, copy.cta, copy.close]);
      expect(findBannedClaim(texts, DEFAULT_BANNED_CLAIMS, false)).toBeNull();
    }
  });
});

describe("modal rule", () => {
  const entry = DEFAULT_PROMPT_CATALOG.trial_ended;

  it("rejects a modal on a kind that is not calm and accepts the calm ones", () => {
    const bad = promptCatalogSchema.safeParse({ credits_low: { ...entry, form: "modal" } });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain("modal_not_allowed");
    expect(promptCatalogSchema.safeParse({ credits_out: { ...entry, form: "modal" } }).success).toBe(true);
    expect(promptCatalogSchema.safeParse({ trial_ended: { ...entry, form: "modal" } }).success).toBe(true);
  });

  it("is enforced where the settings are saved", () => {
    const parsed = growthSchema.safeParse({
      prompts: { catalog: { plan_expiring: { ...entry, form: "modal" } } },
    });
    expect(parsed.success).toBe(false);
  });

  it("knows the calm surfaces", () => {
    expect(isCalmSurface("dashboard")).toBe(true);
    expect(isCalmSurface("analyze_start")).toBe(true);
    for (const surface of ["result", "locked", "credits", "pricing"] as const) {
      expect(isCalmSurface(surface), surface).toBe(false);
    }
  });
});

describe("claims lint", () => {
  it("matches case-insensitively and with Arabic letters normalized", () => {
    expect(findBannedClaim(["Guaranteed results"], DEFAULT_BANNED_CLAIMS, false)).toBe("guaranteed");
    expect(findBannedClaim(["تحليل ادق"], DEFAULT_BANNED_CLAIMS, false)).toBe("أدق");
    expect(findBannedClaim(["نتيجة مضمونة"], DEFAULT_BANNED_CLAIMS, false)).toBe("مضمون");
  });

  it("does not match a Latin term inside another word", () => {
    expect(findBannedClaim(["Secure payment, procure nothing"], DEFAULT_BANNED_CLAIMS, false)).toBeNull();
    expect(findBannedClaim(["a cure for everything"], DEFAULT_BANNED_CLAIMS, false)).toBe("cure");
  });

  it("frees only the deep pair when the plan has deep mode", () => {
    expect(findBannedClaim(["a more accurate reading"], DEFAULT_BANNED_CLAIMS, true)).toBeNull();
    expect(findBannedClaim(["تحليل أدق"], DEFAULT_BANNED_CLAIMS, true)).toBeNull();
    expect(findBannedClaim(["guaranteed and more accurate"], DEFAULT_BANNED_CLAIMS, true)).toBe("guaranteed");
  });

  it("is applied when the growth settings are saved (the terms never allowed)", () => {
    const entry = DEFAULT_PROMPT_CATALOG.credits_low;
    const parsed = growthSchema.safeParse({
      prompts: {
        catalog: {
          credits_low: {
            ...entry,
            copy: { ...entry.copy, ar: { ...entry.copy.ar, body: "هذا علاج مضمون" } },
          },
        },
      },
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("banned_claim");
  });
});

describe("renderPromptText", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    expect(renderPromptText("{plan} بـ {price} {nope}", { plan: "برو", price: "299" })).toBe("برو بـ 299 {nope}");
    expect(renderPromptText("a{deepLine}b", { deepLine: "" })).toBe("ab");
  });
});
