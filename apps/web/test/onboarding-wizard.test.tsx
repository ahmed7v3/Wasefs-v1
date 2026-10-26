// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingWizard } from "../src/components/onboarding/onboarding-wizard";
import { conflictMessageKey } from "../src/components/onboarding/step-copy";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { OnboardingState } from "@wasfa/shared/schemas/onboarding";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
// The growth queue talks to the network; these tests only count the requests of the wizard itself.
vi.mock("../src/lib/growth-events", () => ({ trackGrowth: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const answers: OnboardingState["answers"] = {
  accountType: "individual",
  name: "سارة أحمد",
  phone: null,
  phoneVerified: false,
  phoneSkippable: false,
  organization: null,
  profession: null,
  usageIntent: [],
  country: null,
  city: null,
  plan: null,
};

/** Individual path with the phone step already behind the user: 5 steps, the second is current. */
function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    currentStep: "name",
    done: false,
    completedAt: null,
    steps: [
      { step: "account_type", status: "completed", optional: false },
      { step: "name", status: "current", optional: false },
      { step: "profession_intent", status: "pending", optional: false },
      { step: "social_follow", status: "pending", optional: true },
      { step: "plan_picker", status: "pending", optional: false },
    ],
    answers,
    ...overrides,
  };
}

/** The same wizard with `current` as the only open step: everything before it done, after it pending. */
function at(current: OnboardingState["steps"][number]["step"]): OnboardingState {
  const order = state().steps.map((entry) => entry.step);
  const index = order.indexOf(current);
  return state({
    currentStep: current,
    steps: state().steps.map((entry, position) => ({
      ...entry,
      status: position < index ? "completed" : position === index ? "current" : "pending",
    })),
  });
}

const price = (months: number, perMonthMinor: number, headlineMinor: number) => ({
  months,
  amountMinor: headlineMinor,
  promotionId: null,
  display: { headlineMinor, struckMinor: null, savingsMinor: 0, perMonthMinor },
});

function paidPlan(
  key: string,
  nameAr: string,
  audience: CatalogResponse["plans"][number]["audience"],
): CatalogResponse["plans"][number] {
  return {
    key,
    audience,
    names: { ar: nameAr, en: key },
    tagline: null,
    features: [],
    badge: null,
    pinRecommended: false,
    trialDays: 0,
    monthlyCredits: 150,
    maxMembers: null,
    fairUseNote: null,
    prices: [price(1, 9_900, 9_900), price(12, 8_000, 96_000)],
  };
}

const catalog: CatalogResponse = {
  currency: "EGP",
  country: null,
  plans: [
    paidPlan("plus", "بلس", "individual"),
    paidPlan("clinic", "عيادة", "organization"),
    paidPlan("everyone", "للجميع", "any"),
  ],
  freePlan: {
    key: "free",
    names: { ar: "مجانية الكتالوج", en: "Free" },
    tagline: null,
    features: [],
    badge: null,
    monthlyCredits: 25,
  },
  promotions: [],
  creditPacks: [],
  tax: { mode: "none" },
  methods: [],
  billing: { trialAvailable: false, reviewSlaMinutes: 60, refundWindowDays: 7 },
};

function renderWizard(
  initial: OnboardingState = state(),
  facebookUrl: string | null = null,
  plans: CatalogResponse | null = catalog,
) {
  return render(
    <OnboardingWizard
      initial={initial}
      freeMonthlyAnalyses={3}
      facebookUrl={facebookUrl}
      catalog={plans}
    />,
  );
}

beforeEach(() => {
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OnboardingWizard", () => {
  it("renders the current step from the server state, with one h1 and progress among the applicable steps", () => {
    renderWizard();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      t("onboarding.step.name.title"),
    );
    expect(screen.getByText(t("onboarding.stepOf", { current: 2, total: 5 }))).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    // Prefilled from the saved answer.
    expect(screen.getByDisplayValue("سارة أحمد")).toBeTruthy();
  });

  it("saves the step with PUT and renders the state the server returns", async () => {
    fetchMock.mockResolvedValue(json(at("profession_intent")));
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: t("common.next") }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        t("onboarding.step.profession_intent.title"),
      );
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/onboarding\/name$/);
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ name: "سارة أحمد" }));
    expect(screen.getByText(t("onboarding.stepOf", { current: 3, total: 5 }))).toBeTruthy();
  });

  it("goes back to the previous applicable step without a request, and can re-submit it", async () => {
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: t("common.back") }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      t("onboarding.step.account_type.title"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    // The first step has no back button.
    expect(screen.queryByRole("button", { name: t("common.back") })).toBeNull();

    fetchMock.mockResolvedValue(json(state()));
    await userEvent.click(
      screen.getByRole("radio", { name: new RegExp(t("accountType.organization")) }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.next") }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/onboarding\/account_type$/);
    expect(init?.body).toBe(JSON.stringify({ accountType: "organization" }));
  });

  it("explains a CONFLICT by its reason and re-syncs with the server", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ code: "CONFLICT", message: "x", details: { reason: "step_out_of_order" } }, 409),
      )
      .mockResolvedValueOnce(json(at("profession_intent")));
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: t("common.next") }));

    await waitFor(() => {
      expect(screen.getByText(t("onboarding.conflict.step_out_of_order"))).toBeTruthy();
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/onboarding$/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      t("onboarding.step.profession_intent.title"),
    );
  });

  it("leaves for the dashboard when the server says onboarding is done", async () => {
    fetchMock.mockResolvedValue(
      json(state({ currentStep: "done", done: true, completedAt: "2026-01-01T00:00:00.000Z" })),
    );
    renderWizard(at("plan_picker"));
    // Free is preselected: one click finishes onboarding.
    await userEvent.click(screen.getByRole("button", { name: t("onboarding.plan.startFree") }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/onboarding\/plan_picker$/);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ plan: "free" }));
    expect(screen.getByRole("status").textContent).toContain(t("onboarding.plan.activating"));
  });

  it("answers the social step with followed: false and moves on to the plan", async () => {
    fetchMock.mockResolvedValue(json(at("plan_picker")));
    renderWizard(at("social_follow"));
    await userEvent.click(screen.getByRole("button", { name: t("common.next") }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        t("onboarding.step.plan_picker.title"),
      );
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ followed: false }));
  });

  it("offers the Facebook page and a skip on the social step", async () => {
    fetchMock.mockResolvedValue(json(state({ currentStep: "done", done: true })));
    renderWizard(at("social_follow"), "https://facebook.com/wasfa");
    const link = screen.getByRole("link", { name: t("onboarding.social.follow") });
    expect(link.getAttribute("href")).toBe("https://facebook.com/wasfa");
    expect(link.getAttribute("target")).toBe("_blank");
    await userEvent.click(screen.getByRole("button", { name: t("onboarding.social.skip") }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ followed: false }));
  });

  describe("plan step", () => {
    const done = () =>
      json(state({ currentStep: "done", done: true, completedAt: "2026-01-01T00:00:00.000Z" }));
    const planCards = () =>
      within(
        screen.getByRole("group", { name: t("onboarding.plan.optionsLabel") }),
      ).getAllByRole<HTMLInputElement>("radio");
    const planNames = () => planCards().map((radio) => radio.closest("label")?.textContent ?? "");

    it("preselects the free plan, first, with the catalog name and credits", () => {
      renderWizard(at("plan_picker"));
      const [first] = planCards();
      expect(first?.value).toBe("free");
      expect(first?.checked).toBe(true);
      expect(planNames()[0]).toContain("مجانية الكتالوج");
      expect(planNames()[0]).toContain(t("billing.plan.monthlyCredits", { count: 25 }));
      expect(screen.getByText(t("onboarding.plan.changeLater"))).toBeTruthy();
    });

    it("sends a paid choice to checkout with the plan and period", async () => {
      fetchMock.mockResolvedValue(done());
      renderWizard(at("plan_picker"));
      await userEvent.click(screen.getByRole("radio", { name: /بلس/ }));
      await userEvent.click(
        screen.getByRole("button", { name: t("onboarding.plan.continuePaid") }),
      );
      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith("/checkout?plan=plus&months=12&currency=EGP");
      });
      expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
        JSON.stringify({ plan: "paid", planKey: "plus", months: 12 }),
      );
      expect(screen.getByRole("status").textContent).toContain(t("onboarding.plan.toCheckout"));
    });

    it("follows the period switch", async () => {
      fetchMock.mockResolvedValue(done());
      renderWizard(at("plan_picker"));
      await userEvent.click(
        within(screen.getByRole("group", { name: t("billing.pricing.period") })).getByRole(
          "radio",
          {
            name: new RegExp(t("billing.pricing.monthly")),
          },
        ),
      );
      await userEvent.click(screen.getByRole("radio", { name: /بلس/ }));
      await userEvent.click(
        screen.getByRole("button", { name: t("onboarding.plan.continuePaid") }),
      );
      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith("/checkout?plan=plus&months=1&currency=EGP");
      });
    });

    it("shows an individual only the individual and any plans", () => {
      renderWizard(at("plan_picker"));
      const text = planNames().join("|");
      expect(text).toContain("بلس");
      expect(text).toContain("للجميع");
      expect(text).not.toContain("عيادة");
    });

    it("shows an organization only the organization and any plans, and checks out for it", async () => {
      fetchMock.mockResolvedValue(done());
      const orgId = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
      const initial = at("plan_picker");
      renderWizard({
        ...initial,
        answers: {
          ...initial.answers,
          accountType: "organization",
          organization: { id: orgId, name: "Nile", type: "pharmacy", country: "EG", city: null },
        },
      });
      const text = planNames().join("|");
      expect(text).toContain("عيادة");
      expect(text).toContain("للجميع");
      expect(text).not.toContain("بلس");
      await userEvent.click(screen.getByRole("radio", { name: /عيادة/ }));
      await userEvent.click(
        screen.getByRole("button", { name: t("onboarding.plan.continuePaid") }),
      );
      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith(
          `/checkout?plan=clinic&months=12&currency=EGP&org=${orgId}`,
        );
      });
    });

    it("offers only the free plan, with no coming-soon text, when there is no catalog", () => {
      renderWizard(at("plan_picker"), null, null);
      expect(planCards()).toHaveLength(1);
      expect(planNames()[0]).toContain(t("onboarding.plan.free"));
      expect(planNames()[0]).toContain(t("billing.plan.monthlyCredits", { count: 3 }));
      expect(screen.queryByText(t("ui.comingSoon"))).toBeNull();
      expect(screen.getByRole("button", { name: t("onboarding.plan.startFree") })).toBeTruthy();
    });
  });
});

describe("conflictMessageKey", () => {
  it("maps every reason the API gives and falls back for an unknown one", () => {
    expect(conflictMessageKey("phone_not_verified")).toBe("onboarding.conflict.phone_not_verified");
    expect(conflictMessageKey("account_type_locked")).toBe(
      "onboarding.conflict.account_type_locked",
    );
    expect(conflictMessageKey("something_new")).toBe("onboarding.conflict.generic");
    expect(conflictMessageKey(undefined)).toBe("onboarding.conflict.generic");
  });
});
