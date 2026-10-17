// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsappNotifications } from "../src/components/account/whatsapp-notifications";

import type { NotificationPrefsResponse } from "@wasfa/shared/schemas/notification-prefs";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let current: NotificationPrefsResponse;

beforeEach(() => {
  fetchMock.mockReset();
  current = { whatsapp: { available: true, enabled: true, active: true } };
  fetchMock.mockImplementation((url, init) => {
    if (!String(url).endsWith("/me/notification-prefs")) return Promise.resolve(json({}, 404));
    if ((init?.method ?? "GET") === "PUT") {
      const { whatsapp } = JSON.parse(String(init?.body)) as { whatsapp: boolean };
      current = { whatsapp: { ...current.whatsapp, enabled: whatsapp } };
    }
    return Promise.resolve(json(current));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = () =>
  render(
    <ToastProvider>
      <WhatsappNotifications />
    </ToastProvider>,
  );

describe("WhatsApp notifications on the account page", () => {
  it("turns them off and back on for a verified phone", async () => {
    view();
    const toggle = await screen.findByRole<HTMLInputElement>("switch", {
      name: t("account.notifications.whatsappLabel"),
    });
    expect(toggle.checked).toBe(true);
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.checked).toBe(false);
    });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ whatsapp: false });
    expect(screen.getByText(t("account.notifications.whatsappHint"))).toBeTruthy();
  });

  it("says when the owner has not switched WhatsApp messages on", async () => {
    current = { whatsapp: { available: true, enabled: true, active: false } };
    view();
    expect(await screen.findByText(t("account.notifications.whatsappInactive"))).toBeTruthy();
  });

  it("shows nothing without a verified phone", async () => {
    current = { whatsapp: { available: false, enabled: false, active: true } };
    view();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
