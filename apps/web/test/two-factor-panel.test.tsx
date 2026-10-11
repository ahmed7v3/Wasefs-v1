// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackupCodes } from "../src/components/account/backup-codes";
import { TwoFactorPanel, secretFromUri } from "../src/components/account/two-factor-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh }) }));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CODES = ["a1b2c-d3e4f", "g5h6i-j7k8l", "m9n0o-p1q2r"];
const TOTP_URI =
  "otpauth://totp/Wasfa%20AI:sara%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Wasfa";

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The text input with this name, failing the test (not the type checker) when it is missing. */
function field(name: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`input[name=${name}]`);
  if (!input) throw new Error(`no input named ${name}`);
  return input;
}

describe("secretFromUri", () => {
  it("reads the manual key out of the otpauth URI", () => {
    expect(secretFromUri(TOTP_URI)).toBe("JBSWY3DPEHPK3PXP");
    expect(secretFromUri("not a uri")).toBe("");
  });
});

describe("BackupCodes", () => {
  it("lists the codes and only lets the user finish once they confirmed they saved them", async () => {
    const onDone = vi.fn();
    render(<BackupCodes codes={CODES} onDone={onDone} />);
    for (const code of CODES) expect(screen.getByText(code)).toBeTruthy();

    const finish = screen.getByRole("button", { name: t("account.twoFactor.finish") });
    expect(finish.hasAttribute("disabled")).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", { name: t("account.twoFactor.saved") }));
    expect(finish.hasAttribute("disabled")).toBe(false);
    await userEvent.click(finish);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("TwoFactorPanel", () => {
  it("shows the backup codes once: after the first code is confirmed, until the user says they saved them", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ totpURI: TOTP_URI, backupCodes: CODES })) // enable
      .mockResolvedValueOnce(json({ token: "x", user: {} })); // verify-totp
    render(
      <ToastProvider>
        <TwoFactorPanel enabled={false} />
      </ToastProvider>,
    );
    expect(screen.getByText(t("account.twoFactor.off"))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: t("account.twoFactor.enable") }));

    await userEvent.type(field("password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: t("account.twoFactor.start") }));

    // Scan step: the manual key is there, the codes are not shown yet.
    await screen.findByText("JBSWY3DPEHPK3PXP");
    expect(screen.queryByText(CODES[0] ?? "")).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/auth\/two-factor\/enable$/);

    await userEvent.type(field("code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: t("account.twoFactor.confirm") }));
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/auth\/two-factor\/verify-totp$/);

    await screen.findByText(CODES[0] ?? "");
    await userEvent.click(screen.getByRole("checkbox", { name: t("account.twoFactor.saved") }));
    await userEvent.click(screen.getByRole("button", { name: t("account.twoFactor.finish") }));

    // Gone for good, and the panel now offers to turn it off.
    await waitFor(() => {
      expect(screen.queryByText(CODES[0] ?? "")).toBeNull();
    });
    expect(screen.getByText(t("account.twoFactor.on"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("account.twoFactor.disable") })).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
});
