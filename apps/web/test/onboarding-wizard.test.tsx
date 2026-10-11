// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingWizard } from "../src/components/onboarding/onboarding-wizard";
import { conflictMessageKey } from "../src/components/onboarding/step-copy";

import type { OnboardingState } from "@wasfa/shared/schemas/onboarding";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

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
      { step: "plan_picker", status: "pending", optional: false },
      { step: "social_follow", status: "pending", optional: true },
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

function renderWizard(initial: OnboardingState = state(), facebookUrl: string | null = null) {
  return render(
    <OnboardingWizard initial={initial} freeMonthlyAnalyses={3} facebookUrl={facebookUrl} />,
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
    renderWizard(at("social_follow"));
    // No Facebook page configured: a single finish button answers `followed: false`.
    await userEvent.click(screen.getByRole("button", { name: t("onboarding.finish") }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
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

  it("shows the free plan with the monthly analyses from the settings", () => {
    renderWizard(at("plan_picker"));
    expect(screen.getByText(t("onboarding.plan.freeQuota", { count: 3 }))).toBeTruthy();
    expect(screen.getByText(t("ui.comingSoon"))).toBeTruthy();
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
