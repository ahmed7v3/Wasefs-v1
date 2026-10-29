// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppLogin } from "../src/components/auth/whatsapp-login";
import {
  formatCountdown,
  nextPhase,
  signedInTarget,
  whatsappWebLink,
} from "../src/lib/whatsapp-login";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const WA_LINK = "https://wa.me/201555000111?text=%D8%B1%D9%85%D8%B2%20WASFA-ABCD-1234";
const NOW = Date.parse("2026-10-29T10:00:00Z");

function answers(statuses: unknown[]) {
  const queue = [...statuses];
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/auth/whatsapp/start")) {
      return Promise.resolve(
        json({
          code: "ABCD-1234",
          waLink: WA_LINK,
          expiresAt: new Date(NOW + 5 * 60_000).toISOString(),
        }),
      );
    }
    return Promise.resolve(json(queue.shift() ?? { status: "pending" }));
  });
}

function setMobile(mobile: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: mobile })),
  );
  window.matchMedia = globalThis.matchMedia;
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  });
  vi.setSystemTime(NOW);
  setMobile(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function open() {
  fireEvent.click(screen.getByRole("button", { name: t("auth.whatsapp.button") }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("WhatsAppLogin", () => {
  it("is not drawn when sign-in with WhatsApp is off", () => {
    const { container } = render(<WhatsAppLogin available={false} next="/dashboard" />);
    expect(container.childElementCount).toBe(0);
  });

  it("offers the button, the terms line with both links, and the or divider", () => {
    render(<WhatsAppLogin available next="/dashboard" />);
    expect(screen.getByRole("button", { name: t("auth.whatsapp.button") })).toBeTruthy();
    expect(screen.getByRole("link", { name: t("auth.terms.terms") }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(screen.getByRole("link", { name: t("auth.terms.privacy") }).getAttribute("href")).toBe(
      "/privacy",
    );
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("on a computer shows the code, the WhatsApp Web link and a countdown", async () => {
    answers([]);
    render(<WhatsAppLogin available next="/dashboard" />);
    await open();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    const web = screen.getByRole("link", { name: t("auth.whatsapp.openWeb") });
    expect(web.getAttribute("href")).toMatch(
      /^https:\/\/web\.whatsapp\.com\/send\?phone=201555000111/,
    );
    expect(screen.queryByRole("link", { name: t("auth.whatsapp.openWhatsapp") })).toBeNull();
    expect(screen.getByText(t("auth.whatsapp.countdown", { time: "5:00" }))).toBeTruthy();

    await tick(1_000);
    expect(screen.getByText(t("auth.whatsapp.countdown", { time: "4:59" }))).toBeTruthy();
  });

  it("on a phone shows the big open-WhatsApp link to the wa.me link", async () => {
    setMobile(true);
    answers([]);
    render(<WhatsAppLogin available next="/dashboard" />);
    await open();
    const link = screen.getByRole("link", { name: t("auth.whatsapp.openWhatsapp") });
    expect(link.getAttribute("href")).toBe(WA_LINK);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: t("auth.whatsapp.openWeb") })).toBeNull();
  });

  it("polls every 2 seconds and goes to next when signed in", async () => {
    answers([{ status: "pending" }, { status: "signed_in", isNew: false }]);
    render(<WhatsAppLogin available next="/account/security" />);
    await open();
    await tick(2_000);
    expect(replace).not.toHaveBeenCalled();
    await tick(2_000);
    expect(replace).toHaveBeenCalledWith("/account/security");
    const polls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/status?token="));
    expect(String(polls[0]?.[0])).toContain("token=ABCD-1234");
  });

  it("sends a brand-new account to onboarding", async () => {
    answers([{ status: "signed_in", isNew: true }]);
    render(<WhatsAppLogin available next="/account/security" />);
    await open();
    await tick(2_000);
    expect(replace).toHaveBeenCalledWith("/welcome");
  });

  it("does not poll while the tab is hidden, and polls at once when it returns", async () => {
    answers([{ status: "signed_in", isNew: false }]);
    render(<WhatsAppLogin available next="/dashboard" />);
    await open();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await tick(6_000);
    expect(replace).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(0);
    expect(replace).toHaveBeenCalledWith("/dashboard");
    hidden.mockRestore();
  });

  it.each([
    ["two_factor", "auth.whatsapp.refused.two_factor"],
    ["privileged", "auth.whatsapp.refused.privileged"],
    ["inactive", "auth.whatsapp.refused.inactive"],
  ] as const)("explains a %s refusal and points to the password", async (reason, key) => {
    answers([{ status: "refused", reason }]);
    render(<WhatsAppLogin available next="/dashboard" passwordHref="/login" />);
    await open();
    await tick(2_000);
    expect(screen.getByText(t(key))).toBeTruthy();
    expect(
      screen.getByRole("link", { name: t("auth.whatsapp.usePassword") }).getAttribute("href"),
    ).toBe("/login");
    expect(replace).not.toHaveBeenCalled();
  });

  it("expires after five minutes and offers a fresh start", async () => {
    answers([]);
    render(<WhatsAppLogin available next="/dashboard" />);
    await open();
    await tick(5 * 60_000 + 1_000);
    expect(screen.getByText(t("auth.whatsapp.expired"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("auth.whatsapp.restart") }));
    await tick(0);
    const starts = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/whatsapp/start"));
    expect(starts).toHaveLength(2);
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
  });

  it("shows an error with a retry when the challenge cannot be started", async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          code: "UPSTREAM_UNAVAILABLE",
          message: "x",
          details: { reason: "whatsapp_login_unavailable" },
        },
        503,
      ),
    );
    render(<WhatsAppLogin available next="/dashboard" />);
    await open();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("common.retry") })).toBeTruthy();
  });
});

describe("whatsapp login rules", () => {
  it("formats the countdown", () => {
    expect(formatCountdown(300_000)).toBe("5:00");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("picks the destination", () => {
    expect(signedInTarget("/billing", false)).toBe("/billing");
    expect(signedInTarget("/billing", undefined)).toBe("/billing");
    expect(signedInTarget("/billing", true)).toBe("/welcome");
  });

  it("only turns wa.me links into WhatsApp Web links", () => {
    expect(whatsappWebLink("https://wa.me/201555000111?text=hi")).toBe(
      "https://web.whatsapp.com/send?phone=201555000111&text=hi",
    );
    expect(whatsappWebLink("https://evil.example/201555000111?text=hi")).toBeNull();
    expect(whatsappWebLink("not a url")).toBeNull();
  });

  it("decides what a poll changes", () => {
    const waiting = {
      kind: "waiting",
      token: "ABCD-1234",
      waLink: WA_LINK,
      expiresAt: NOW + 1_000,
      mobile: false,
    } as const;
    expect(nextPhase(waiting, { status: "pending" }, NOW)).toBeNull();
    expect(nextPhase(waiting, { status: "pending" }, NOW + 1_000)).toEqual({ kind: "expired" });
    expect(nextPhase(waiting, { status: "expired" }, NOW)).toEqual({ kind: "expired" });
    expect(nextPhase(waiting, { status: "signed_in" }, NOW)).toEqual({ kind: "signed_in" });
    expect(nextPhase(waiting, { status: "refused", reason: "inactive" }, NOW)).toEqual({
      kind: "refused",
      reason: "inactive",
    });
  });
});
