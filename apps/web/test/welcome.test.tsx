// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppMagicLink } from "../src/components/auth/whatsapp-magic-link";
import { FOLLOW_DISMISSED_KEY, FollowCard } from "../src/components/dashboard/follow-card";
import { WelcomeCard } from "../src/components/onboarding/welcome-card";
import { label } from "../src/lib/labels";
import { isProtectedPath } from "../src/lib/route-guard";
import { magicTokenFromHash } from "../src/lib/whatsapp-login";

import type { OnboardingState } from "@wasfa/shared/schemas/onboarding";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push: vi.fn() }) }));
// The phone block has its own tests; here it only has to appear.
vi.mock("../src/components/phone-verification", () => ({
  PhoneVerification: ({ onVerified }: { onVerified: () => void }) => (
    <button type="button" onClick={onVerified}>
      phone-block
    </button>
  ),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function state(overrides: Partial<OnboardingState["answers"]> = {}): OnboardingState {
  return {
    currentStep: "account_type",
    done: false,
    completedAt: null,
    steps: [],
    answers: {
      accountType: "individual",
      name: "Mona Ali",
      phone: null,
      phoneVerified: true,
      phoneSkippable: false,
      organization: null,
      profession: null,
      usageIntent: [],
      country: null,
      city: null,
      plan: null,
      ...overrides,
    },
  };
}

const done = { ...state(), done: true, currentStep: "done" };

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/onboarding/welcome"));
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

describe("WelcomeCard", () => {
  it("greets with the prefilled name and finishes with one button", async () => {
    fetchMock.mockResolvedValue(json(done));
    render(<WelcomeCard initial={state()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Mona");
    expect(screen.queryByText("phone-block")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("welcome.start") }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    expect(lastBody()).toEqual({ name: "Mona Ali", accountType: "individual" });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("PUT");
  });

  it("sends the chosen profession, and a second tap on the chip clears it", async () => {
    fetchMock.mockResolvedValue(json(done));
    render(<WelcomeCard initial={state()} />);
    const chip = screen.getByRole("button", { name: label("profession", "pharmacist") });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("button", { name: t("welcome.start") }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    expect(lastBody()).toMatchObject({ profession: "pharmacist" });
  });

  it("reveals the organization fields only for an organization, and needs them", async () => {
    fetchMock.mockResolvedValue(json(done));
    render(<WelcomeCard initial={state()} />);
    expect(screen.queryByLabelText(new RegExp(t("onboarding.org.name")))).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: t("welcome.forOrg") }));
    expect(screen.getByLabelText(new RegExp(t("onboarding.org.name")))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("welcome.start") }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(new RegExp(t("onboarding.org.name"))), {
      target: { value: "صيدلية النور" },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(t("onboarding.org.type"))), {
      target: { value: "pharmacy" },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(t("field.country"))), {
      target: { value: "EG" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("welcome.start") }));
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    expect(lastBody()).toMatchObject({
      accountType: "organization",
      organization: { name: "صيدلية النور", type: "pharmacy", country: "EG" },
    });
  });

  it("shows the phone block above a disabled button until the phone is verified", () => {
    render(<WelcomeCard initial={state({ phoneVerified: false })} />);
    expect(screen.getByText("phone-block")).toBeTruthy();
    const start = screen.getByRole<HTMLButtonElement>("button", { name: t("welcome.start") });
    expect(start.disabled).toBe(true);

    fireEvent.click(screen.getByText("phone-block"));
    expect(start.disabled).toBe(false);
    expect(screen.queryByText("phone-block")).toBeNull();
  });

  it("skips the phone block when the machine says the phone is skippable", () => {
    render(<WelcomeCard initial={state({ phoneVerified: false, phoneSkippable: true })} />);
    expect(screen.queryByText("phone-block")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: t("welcome.start") }).disabled,
    ).toBe(false);
  });

  it("shows the server's refusal and stays on the page", async () => {
    fetchMock.mockResolvedValue(
      json({ code: "CONFLICT", message: "x", details: { reason: "phone_not_verified" } }, 409),
    );
    render(<WelcomeCard initial={state()} />);
    fireEvent.click(screen.getByRole("button", { name: t("welcome.start") }));
    await screen.findByRole("alert");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("FollowCard", () => {
  const FACEBOOK = "https://facebook.com/wasfa";
  const list = (statuses: string[]) =>
    json({
      items: statuses.map((status, index) => ({
        id: `00000000-0000-4000-8000-00000000000${String(index)}`,
        status,
        mode: "balanced",
        createdAt: "2026-10-29T10:00:00.000Z",
        itemCount: 1,
        itemNames: ["Panadol"],
        pageCount: 1,
        creditsCharged: 3,
      })),
      nextCursor: null,
    });

  it("appears after the first successful analysis", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(list(["failed", "done"])));
    render(<FollowCard facebookUrl={FACEBOOK} followed={false} />);
    expect(await screen.findByText(t("dashboard.follow.title"))).toBeTruthy();
  });

  it("stays away before any analysis succeeded, once followed, and without a page", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(list(["failed", "queued"])));
    const early = render(<FollowCard facebookUrl={FACEBOOK} followed={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(early.container.childElementCount).toBe(0);
    early.unmount();

    fetchMock.mockImplementation(() => Promise.resolve(list(["done"])));
    const followed = render(<FollowCard facebookUrl={FACEBOOK} followed />);
    const noPage = render(<FollowCard facebookUrl={null} followed={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(followed.container.childElementCount).toBe(0);
    expect(noPage.container.childElementCount).toBe(0);
  });

  it("can be dismissed, and stays dismissed", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(list(["done"])));
    const first = render(<FollowCard facebookUrl={FACEBOOK} followed={false} />);
    fireEvent.click(await screen.findByRole("button", { name: t("dashboard.follow.dismiss") }));
    expect(window.localStorage.getItem(FOLLOW_DISMISSED_KEY)).toBe("1");
    expect(first.container.childElementCount).toBe(0);
    first.unmount();

    const again = render(<FollowCard facebookUrl={FACEBOOK} followed={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(again.container.childElementCount).toBe(0);
  });

  it("records the follow on the account when the link is used", async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        String(input).includes("/onboarding/followed") ? json({}, 204) : list(["done"]),
      ),
    );
    render(<FollowCard facebookUrl={FACEBOOK} followed={false} />);
    const link = await screen.findByRole("link", { name: t("dashboard.follow.action") });
    expect(link.getAttribute("href")).toBe(FACEBOOK);
    fireEvent.click(link);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith("/onboarding/followed")),
      ).toBe(true);
    });
  });
});

describe("WhatsAppMagicLink", () => {
  const TOKEN = "A".repeat(43);

  beforeEach(() => {
    window.history.replaceState(null, "", "/auth/whatsapp/link");
  });

  it("clears the fragment at once, posts the token in the body, and goes to the dashboard", async () => {
    window.location.hash = `#t=${TOKEN}`;
    fetchMock.mockResolvedValue(json({ status: "signed_in", isNew: false }));
    render(<WhatsAppMagicLink />);
    expect(window.location.hash).toBe("");
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/auth\/whatsapp\/magic$/);
    expect(String(url)).not.toContain(TOKEN);
    expect(init?.body).toBe(JSON.stringify({ token: TOKEN }));
  });

  it("sends a brand-new account to /welcome", async () => {
    window.location.hash = `#t=${TOKEN}`;
    fetchMock.mockResolvedValue(json({ status: "signed_in", isNew: true }));
    render(<WhatsAppMagicLink />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/welcome");
    });
  });

  it("shows one invalid page for a failed, missing or malformed token, with a way back", async () => {
    window.location.hash = `#t=${TOKEN}`;
    fetchMock.mockResolvedValue(json({ code: "AUTH_REQUIRED", message: "x" }, 401));
    const failed = render(<WhatsAppMagicLink />);
    expect((await screen.findByText(t("auth.whatsapp.link.invalid"))).textContent).toBeTruthy();
    expect(screen.getByRole("link", { name: t("auth.whatsapp.button") }).getAttribute("href")).toBe(
      "/login",
    );
    failed.unmount();

    fetchMock.mockClear();
    window.location.hash = "#t=short";
    render(<WhatsAppMagicLink />);
    expect(await screen.findByText(t("auth.whatsapp.link.invalid"))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  it("/welcome needs a session", () => {
    expect(isProtectedPath("/welcome")).toBe(true);
  });

  it("reads only a well-formed fragment token", () => {
    expect(magicTokenFromHash(`#t=${"B".repeat(43)}`)).toBe("B".repeat(43));
    expect(magicTokenFromHash("#t=short")).toBeNull();
    expect(magicTokenFromHash("")).toBeNull();
    expect(magicTokenFromHash(`#x=${"B".repeat(43)}`)).toBeNull();
  });
});
