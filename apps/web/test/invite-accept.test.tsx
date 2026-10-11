// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InviteAccept } from "../src/components/invite/invite-accept";
import { INVITE_STORAGE_KEY, isInviteToken, takeInviteToken } from "../src/lib/invite-storage";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TOKEN = "A".repeat(43);
const ME = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sara",
  email: "sara@example.com",
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  image: null,
  accountType: "individual",
  locale: "ar",
  twoFactorEnabled: false,
  roles: [],
  permissions: [],
  profile: { displayName: null, profession: null, usageIntent: [], country: null, city: null },
  onboarding: { currentStep: "done", done: true },
  organizations: [],
  canUseTools: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const ORG = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "صيدلية النور",
  type: "pharmacy",
  country: "EG",
  city: null,
  myRole: "org_member",
  memberCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const unauthenticated = () => json({ code: "AUTH_REQUIRED", message: "x" }, 401);

function openInvite(hash: string) {
  window.history.replaceState(null, "", `/invite${hash}`);
}

function renderPage() {
  return render(
    <ToastProvider>
      <InviteAccept />
    </ToastProvider>,
  );
}

beforeEach(() => {
  replace.mockReset();
  fetchMock.mockReset();
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("takeInviteToken", () => {
  it("moves the token from the fragment into sessionStorage and clears the fragment", () => {
    openInvite(`#${TOKEN}`);
    expect(takeInviteToken()).toBe(TOKEN);
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBe(TOKEN);
    expect(window.location.hash).toBe("");
    // After a sign-in detour the fragment is gone; the stored token still answers.
    expect(takeInviteToken()).toBe(TOKEN);
  });

  it("ignores a fragment that is not a token", () => {
    openInvite("#not-a-token");
    expect(takeInviteToken()).toBeNull();
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBeNull();
    expect(isInviteToken(TOKEN)).toBe(true);
    expect(isInviteToken("short")).toBe(false);
  });
});

describe("InviteAccept", () => {
  it("says so when there is no invitation link", async () => {
    openInvite("");
    renderPage();
    await screen.findByText(t("invite.missing.title"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks a signed-out visitor to sign in or register, keeping the way back to /invite", async () => {
    openInvite(`#${TOKEN}`);
    fetchMock.mockResolvedValue(unauthenticated());
    renderPage();
    const signIn = await screen.findByRole("link", { name: t("invite.signedOut.signIn") });
    expect(signIn.getAttribute("href")).toBe("/login?next=%2Finvite");
    expect(
      screen.getByRole("link", { name: t("invite.signedOut.register") }).getAttribute("href"),
    ).toBe("/register?next=%2Finvite");
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBe(TOKEN);
    expect(window.location.hash).toBe("");
  });

  it("accepts with the token, spends it, and goes to the dashboard", async () => {
    openInvite(`#${TOKEN}`);
    fetchMock.mockResolvedValueOnce(json(ME)).mockResolvedValueOnce(json(ORG));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: t("invite.accept") }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/dashboard");
    });
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(String(url)).toMatch(/\/invites\/accept$/);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBeNull();
    expect(await screen.findByText(t("invite.accepted", { org: ORG.name }))).toBeTruthy();
  });

  it("explains an invalid, expired or foreign invitation, and drops the token", async () => {
    openInvite(`#${TOKEN}`);
    fetchMock
      .mockResolvedValueOnce(json(ME))
      .mockResolvedValueOnce(json({ code: "NOT_FOUND", message: "x" }, 404));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: t("invite.accept") }));

    await screen.findByText(t("invite.notFound.title"));
    expect(screen.getByText(t("invite.notFound.body"))).toBeTruthy();
    expect(screen.getByText(t("invite.notFound.hint"))).toBeTruthy();
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("is friendly when the account is already a member", async () => {
    openInvite(`#${TOKEN}`);
    fetchMock
      .mockResolvedValueOnce(json(ME))
      .mockResolvedValueOnce(
        json({ code: "CONFLICT", message: "x", details: { reason: "already_member" } }, 409),
      );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: t("invite.accept") }));

    await screen.findByText(t("invite.alreadyMember.title"));
    expect(screen.getByRole("link", { name: t("invite.toDashboard") }).getAttribute("href")).toBe(
      "/dashboard",
    );
    expect(sessionStorage.getItem(INVITE_STORAGE_KEY)).toBeNull();
  });
});
