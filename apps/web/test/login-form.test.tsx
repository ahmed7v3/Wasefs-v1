// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "../src/components/auth/login-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const providers = [
  { id: "google", status: "enabled" },
  { id: "facebook", status: "coming_soon" },
] as const;

beforeEach(() => {
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const emailField = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: new RegExp(`^${t("auth.field.email")}`) });

async function signInWithEmail() {
  await userEvent.type(emailField(), "Sara@Example.com");
  // The email tab comes first in the document; the phone tab's form is hidden.
  const password = document.querySelector<HTMLInputElement>("input[name=password]");
  if (!password) throw new Error("no password field");
  await userEvent.type(password, "secret");
  await userEvent.click(screen.getByRole("button", { name: t("auth.login.submit") }));
}

describe("LoginForm", () => {
  it("signs in and goes to the vetted next path", async () => {
    fetchMock.mockResolvedValue(json({ user: { id: "x" } }));
    render(<LoginForm next="/account/security" providers={[]} />);
    await signInWithEmail();
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/account/security");
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/auth\/sign-in\/email$/);
    expect(init?.body).toBe(JSON.stringify({ email: "sara@example.com", password: "secret" }));
  });

  it("continues to the two-factor screen when the API asks for a code", async () => {
    fetchMock.mockResolvedValue(json({ twoFactorRedirect: true }));
    render(<LoginForm next="/account?tab=1" providers={[]} />);
    await signInWithEmail();
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/login/two-factor?next=%2Faccount%3Ftab%3D1");
    });
  });

  it("says why an unverified address cannot sign in and offers to resend the link", async () => {
    fetchMock.mockResolvedValue(
      json({ code: "AUTH_REQUIRED", message: "x", details: { reason: "email_not_verified" } }, 401),
    );
    render(<LoginForm next="/dashboard" providers={[]} />);
    await signInWithEmail();
    expect(await screen.findByText(t("auth.error.emailNotVerified"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("auth.resend.button") })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a wrong password as a form error and keeps the input", async () => {
    fetchMock.mockResolvedValue(
      json(
        { code: "AUTH_REQUIRED", message: "x", details: { reason: "invalid_credentials" } },
        401,
      ),
    );
    render(<LoginForm next="/dashboard" providers={[]} />);
    await signInWithEmail();
    expect(await screen.findByText(t("auth.error.invalidCredentials"))).toBeTruthy();
    expect(emailField().value).toBe("Sara@Example.com");
  });

  it("draws social buttons from the registry: enabled works, coming soon is disabled, disabled is hidden", async () => {
    render(
      <LoginForm
        next="/dashboard"
        providers={[
          { id: "google", status: "enabled" },
          { id: "facebook", status: "coming_soon" },
        ]}
      />,
    );
    const google = screen.getByRole("button", { name: new RegExp(t("auth.social.google")) });
    expect((google as HTMLButtonElement).disabled).toBe(false);
    const facebook = screen.getByRole("button", { name: new RegExp(t("auth.social.facebook")) });
    expect((facebook as HTMLButtonElement).disabled).toBe(true);
    expect(facebook.getAttribute("aria-disabled")).toBe("true");
    expect(facebook.textContent).toContain(t("ui.comingSoon"));
  });

  it("hides providers that are disabled and the whole block when none is left", () => {
    render(
      <LoginForm
        next="/dashboard"
        providers={[
          { id: "google", status: "disabled" },
          { id: "facebook", status: "disabled" },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: new RegExp(t("auth.social.google")) })).toBeNull();
    expect(screen.queryByText(t("auth.social.or"))).toBeNull();
  });

  it("starts Google sign-in with an absolute callback and follows the returned URL", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    fetchMock.mockResolvedValue(
      json({ url: "https://accounts.google.com/o/oauth2/auth?x=1", redirect: true }),
    );
    render(<LoginForm next="/account" providers={providers.map((p) => ({ ...p }))} />);
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(t("auth.social.google")) }),
    );
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/auth?x=1");
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: "google",
      callbackURL: "https://wasfa.online/account",
    });
  });

  it("refuses a provider URL that is not http(s)", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    fetchMock.mockResolvedValue(json({ url: "javascript:alert(1)" }));
    render(<LoginForm next="/account" providers={providers.map((p) => ({ ...p }))} />);
    await userEvent.click(
      screen.getByRole("button", { name: new RegExp(t("auth.social.google")) }),
    );
    await screen.findByRole("alert");
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows the banners of a verified email and a finished reset", () => {
    const { rerender } = render(<LoginForm next="/dashboard" providers={[]} banner="verified" />);
    expect(screen.getByText(t("auth.login.verifiedBanner"))).toBeTruthy();
    rerender(<LoginForm next="/dashboard" providers={[]} banner="reset" />);
    expect(screen.getByText(t("auth.login.resetBanner"))).toBeTruthy();
  });
});
