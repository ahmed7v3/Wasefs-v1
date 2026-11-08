import { resolvePromptCatalog, resolvePromptEntry } from "@wasfa/shared/growth-prompts";
import { settingDefault } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { PromptCopyService } from "../src/growth/prompt-copy.service.js";
import { PromptsService } from "../src/growth/prompts.service.js";

import type { AuthenticatedUser } from "../src/common/current-user.js";
import type { GrowthPromptKind } from "@wasfa/shared/growth";
import type { PromptEntry } from "@wasfa/shared/growth-prompts";
import type { GrowthPromptQuery } from "@wasfa/shared/schemas/growth";
import type { SettingValue } from "@wasfa/shared/settings";

/*
 * The prompt engine's rules with fakes (conversion-prompts spec): calm surfaces, modals only for the
 * calm kinds, the trial-ended moment showing once, credits-out before any upload, the doubling
 * cooldown, placeholders filled from the plans, and the claims lint. The database and the full app
 * are covered by growth.int.test.ts.
 */

const fake = <T>(value: object) => value as unknown as T;
const DAY = 86_400_000;
const NOW = new Date("2026-11-10T09:00:00Z");
const USER = fake<AuthenticatedUser>({ id: "user-1" });

interface History {
  dismissals: number;
  lastDismissedAt: Date | null;
  lastShownAt: Date | null;
}
const NEVER: History = { dismissals: 0, lastDismissedAt: null, lastShownAt: null };

interface Scenario {
  balance?: number;
  monthly?: number;
  trial?: { granted: number; consumed: number } | null;
  history?: Partial<Record<string, History>>;
  growth?: SettingValue<"growth">;
  deep?: boolean;
  plans?: object[];
  sessionCount?: number;
}

const PLAN = {
  key: "pro",
  audience: "individual",
  names: { ar: "برو", en: "Pro" },
  pinRecommended: false,
  monthlyCredits: 200,
  prices: [{ months: 1, display: { headlineMinor: 29_900 } }],
};

function build(scenario: Scenario = {}) {
  const growth = scenario.growth ?? settingDefault("growth");
  const settings = fake<never>({
    get: (key: string) =>
      Promise.resolve(
        key === "growth"
          ? growth
          : key === "currency"
            ? { default: "EGP", enabled: ["EGP"] }
            : { creditsPerPage: 1 },
      ),
  });
  const repo = fake<never>({
    promptHistory: (_user: string, kind: string) => Promise.resolve(scenario.history?.[kind] ?? NEVER),
    trialCredits: () => Promise.resolve(scenario.trial === undefined ? null : scenario.trial),
    experimentByKey: () => Promise.resolve(undefined),
    liveSubscription: () => Promise.resolve(undefined),
    planHasDeep: () => Promise.resolve(scenario.deep ?? false),
  });
  const catalog = fake<never>({
    catalog: () => Promise.resolve({ plans: scenario.plans ?? [PLAN] }),
  });
  const copy = new PromptCopyService(catalog, settings, repo);
  const credits = fake<never>({
    forUser: () =>
      Promise.resolve({
        wallet: { balance: scenario.balance ?? 0 },
        monthlyCredits: scenario.monthly ?? 20,
        nextGrantAt: "2026-12-01T00:00:00.000Z",
      }),
  });
  const plans = fake<never>({ effectivePlan: () => Promise.resolve({ isDefault: true }) });
  const redis = fake<never>({ get: () => Promise.resolve(String(scenario.sessionCount ?? 0)) });
  const service = new PromptsService(
    repo,
    credits,
    plans,
    fake<never>({}),
    settings,
    fake<never>({}),
    copy,
    redis,
  );
  const ask = (context: GrowthPromptQuery["context"]) =>
    service.next(USER, { context, sessionId: "session-12345" }, NOW);
  return { service, copy, ask, growth };
}

const SPENT = { granted: 20, consumed: 20 };

/** The growth setting with one catalog entry changed (the stored entry is the resolved default plus the change). */
function withEntry(
  growth: SettingValue<"growth">,
  kind: GrowthPromptKind,
  change: Partial<PromptEntry>,
): SettingValue<"growth"> {
  return {
    ...growth,
    prompts: {
      ...growth.prompts,
      catalog: { ...growth.prompts.catalog, [kind]: { ...resolvePromptEntry({}, kind), ...change } },
    },
  };
}

describe("trial_ended", () => {
  it("opens a modal on the dashboard naming a real plan, its analyses and price", async () => {
    const { ask } = build({ trial: SPENT, deep: true });
    const { prompt } = await ask("dashboard");
    expect(prompt?.kind).toBe("trial_ended");
    expect(prompt?.form).toBe("modal");
    const ar = prompt?.content?.ar;
    expect(ar?.title).toBe("خلصت تجربتك المجانية");
    expect(ar?.body).toContain("200 روشتة");
    expect(ar?.body).toContain("برو");
    expect(ar?.body).toContain("وتفتح وضع التحليل العميق");
    expect(ar?.cta).toBe("اشترك في برو");
    expect(ar?.body).not.toMatch(/\{\w+\}/);
    expect(prompt?.content?.en.body).toContain("Pro");
  });

  it("leaves out the deep-mode line when the plan does not have that entitlement", async () => {
    const { ask } = build({ trial: SPENT, deep: false });
    const body = (await ask("dashboard")).prompt?.content?.ar.body ?? "";
    expect(body).not.toContain("التحليل العميق");
    expect(body).toContain("200 روشتة في الشهر بـ");
  });

  it("fires once: a showing without a dismissal is the only one", async () => {
    const shown = { dismissals: 0, lastDismissedAt: null, lastShownAt: new Date(NOW.getTime() - 30 * DAY) };
    const { ask } = build({ trial: SPENT, history: { trial_ended: shown } });
    // The trial prompt does not return; credits out (also a calm modal) takes its place.
    expect((await ask("dashboard")).prompt?.kind).toBe("credits_out");
  });

  it("waits for a real trial grant that is fully spent", async () => {
    expect((await build({ trial: null }).ask("dashboard")).prompt?.kind).toBe("credits_out");
    const partly = build({ trial: { granted: 20, consumed: 12 } });
    expect((await partly.ask("dashboard")).prompt?.kind).toBe("credits_out");
  });

  it("shows again only after the doubling cooldown of its dismissals", async () => {
    const dismissedTwice = (daysAgo: number): History => ({
      dismissals: 2,
      lastDismissedAt: new Date(NOW.getTime() - daysAgo * DAY),
      lastShownAt: new Date(NOW.getTime() - daysAgo * DAY),
    });
    // 7 days x 2^(2-1) = 14 days of quiet.
    const early = build({ trial: SPENT, history: { trial_ended: dismissedTwice(10) } });
    expect((await early.ask("dashboard")).prompt?.kind).not.toBe("trial_ended");
    const later = build({ trial: SPENT, history: { trial_ended: dismissedTwice(15) } });
    expect((await later.ask("dashboard")).prompt?.kind).toBe("trial_ended");
  });

  it("caps the doubling at the maximum cooldown", async () => {
    const dismissed = (daysAgo: number): History => ({
      dismissals: 9,
      lastDismissedAt: new Date(NOW.getTime() - daysAgo * DAY),
      lastShownAt: new Date(NOW.getTime() - daysAgo * DAY),
    });
    const waiting = build({ trial: SPENT, history: { trial_ended: dismissed(59) } });
    expect((await waiting.ask("dashboard")).prompt?.kind).not.toBe("trial_ended");
    const free = build({ trial: SPENT, history: { trial_ended: dismissed(61) } });
    expect((await free.ask("dashboard")).prompt?.kind).toBe("trial_ended");
  });
});

describe("credits_out", () => {
  it("shows on the analyze start screen before any upload, with the free renewal date", async () => {
    const { ask } = build({ trial: null });
    const { prompt } = await ask("analyze_start");
    expect(prompt?.kind).toBe("credits_out");
    expect(prompt?.form).toBe("modal");
    expect(prompt?.content?.en.body).toContain("December 1");
    expect(prompt?.content?.en.body).toContain("Pro");
    expect(prompt?.cta.href).toBe("/pricing");
    expect(prompt?.secondaryHref).toBe("/billing#packs");
  });

  it("does not show on the analyze start screen while credits remain", async () => {
    const { ask } = build({ balance: 5, monthly: 20 });
    expect((await ask("analyze_start")).prompt).toBeNull();
  });
});

describe("calm surfaces and the modal rule", () => {
  it("skips a modal on a surface that is not calm instead of turning it into a card", async () => {
    const { ask } = build({ trial: SPENT });
    expect((await ask("credits")).prompt).toBeNull();
    expect((await ask("pricing")).prompt).toBeNull();
    expect((await ask("result")).prompt).toBeNull();
  });

  it("never opens a modal for a kind that is not calm, even when stored that way", async () => {
    const growth = withEntry(settingDefault("growth"), "credits_low", { form: "modal" });
    const { ask } = build({ balance: 4, monthly: 20, growth });
    expect((await ask("dashboard")).prompt).toBeNull();
  });

  it("serves the credits-low card inline on the dashboard with today's copy", async () => {
    const { ask } = build({ balance: 4, monthly: 20 });
    const { prompt } = await ask("dashboard");
    expect(prompt?.kind).toBe("credits_low");
    expect(prompt?.form).toBe("inline");
    expect(prompt?.content?.ar.body).toBe("استهلكت 16 من 20 رصيدًا هذا الشهر.");
  });

  it("returns nothing when the session already had its prompt", async () => {
    const { ask } = build({ trial: SPENT, sessionCount: 1 });
    expect((await ask("dashboard")).prompt).toBeNull();
  });

  it("skips a disabled prompt and falls through to the next moment", async () => {
    const growth = withEntry(settingDefault("growth"), "trial_ended", { enabled: false });
    const { ask } = build({ trial: SPENT, growth });
    expect((await ask("dashboard")).prompt?.kind).toBe("credits_out");
  });
});

describe("placeholders from the plans", () => {
  it("follows a price change without editing the prompt", async () => {
    const cheaper = { ...PLAN, prices: [{ months: 1, display: { headlineMinor: 19_900 } }] };
    const first = build({ trial: SPENT, plans: [PLAN] });
    const second = build({ trial: SPENT, plans: [cheaper] });
    const a = (await first.ask("dashboard")).prompt?.content?.en.body ?? "";
    const b = (await second.ask("dashboard")).prompt?.content?.en.body ?? "";
    expect(a).not.toBe(b);
    expect(a).toContain("299");
    expect(b).toContain("199");
  });

  it("names the target plan when one is set, else the pinned or the cheapest", async () => {
    const plus = { ...PLAN, key: "plus", names: { ar: "بلس", en: "Plus" }, pinRecommended: true };
    const cheap = { ...PLAN, key: "lite", names: { ar: "لايت", en: "Lite" }, prices: [{ months: 1, display: { headlineMinor: 9_900 } }] };
    const { copy } = build({ plans: [PLAN, plus, cheap] });
    expect((await copy.planFacts(null, NOW))?.key).toBe("plus");
    expect((await copy.planFacts("lite", NOW))?.key).toBe("lite");
    expect((await copy.planFacts("gone", NOW))?.key).toBe("plus");
    const unpinned = build({ plans: [PLAN, cheap] }).copy;
    expect((await unpinned.planFacts(null, NOW))?.key).toBe("lite");
  });

  it("shows no prompt when no plan is on sale to fill the placeholders", async () => {
    const { ask } = build({ trial: SPENT, plans: [] });
    expect((await ask("dashboard")).prompt).toBeNull();
  });
});

describe("claims lint on save", () => {
  const withCopy = (growth: SettingValue<"growth">, body: string) =>
    withEntry(growth, "trial_ended", {
      copy: {
        ar: { title: "", body, cta: "اشترك", close: "لا" },
        en: { title: "", body: "Plans", cta: "Go", close: "No" },
      },
    });

  it("refuses a banned term and names it", async () => {
    const { copy, growth } = build();
    await expect(copy.assertCleanCopy(withCopy(growth, "نتيجة مضمون ١٠٠٪"))).rejects.toMatchObject({
      details: { reason: "banned_claim", key: "trial_ended", term: "مضمون" },
    });
  });

  it("refuses «أدق» unless the target plan has deep mode", async () => {
    const without = build({ deep: false });
    await expect(
      without.copy.assertCleanCopy(withCopy(without.growth, "تحليل أدق في باقة برو")),
    ).rejects.toMatchObject({ details: { term: "أدق" } });
    const withDeep = build({ deep: true });
    await expect(
      withDeep.copy.assertCleanCopy(withCopy(withDeep.growth, "تحليل أدق في باقة برو")),
    ).resolves.toBeUndefined();
  });

  it("accepts every default entry, with and without deep mode", async () => {
    for (const deep of [false, true]) {
      const { copy, growth } = build({ deep });
      const stored = { ...growth, prompts: { ...growth.prompts, catalog: resolvePromptCatalog({}) } };
      await expect(copy.assertCleanCopy(stored)).resolves.toBeUndefined();
    }
  });
});
