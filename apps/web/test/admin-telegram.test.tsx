// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramView } from "../src/components/admin/telegram-view";
import { ReauthProvider } from "../src/lib/reauth";

import type { TelegramSettings, TelegramStatus } from "../src/lib/telegram-admin";

const TOKEN = "123456:ABC-secret-token-value";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const unconfigured: TelegramStatus = {
  configured: false,
  tokenHint: null,
  botUsername: null,
  botName: null,
  webhookUrl: null,
  webhookOk: false,
  pendingUpdates: 0,
  lastError: null,
  enabled: false,
  stats: { chats: 0, linkedChats: 0, sharedPhones: 1, analysesToday: 0, messagesToday: 0 },
};
const configured: TelegramStatus = {
  ...unconfigured,
  configured: true,
  tokenHint: "1234…alue",
  botUsername: "wasfa_bot",
  botName: "Wasfa",
  webhookUrl: "https://api.example.com/telegram/webhook",
  webhookOk: true,
  pendingUpdates: 3,
  enabled: true,
  stats: { chats: 12, linkedChats: 5, sharedPhones: 1, analysesToday: 7, messagesToday: 40 },
};
const settings: TelegramSettings = {
  enabled: true,
  welcomeAr: "مرحبا",
  welcomeEn: "Hello",
  supportUsername: "wasfa_support",
  adsEnabled: true,
};

let current: TelegramStatus;

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes(path) && (init?.method ?? "GET") === method,
  );

beforeEach(() => {
  fetchMock.mockReset();
  current = unconfigured;
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.includes("/admin/telegram/token") && method === "PUT") {
      current = configured;
      return Promise.resolve(json(configured));
    }
    if (path.includes("/admin/telegram/settings")) return Promise.resolve(json(settings));
    if (path.includes("/admin/telegram")) return Promise.resolve(json(current));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
});

function renderView(canWrite = true) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <TelegramView canWrite={canWrite} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

describe("TelegramView", () => {
  it("renders the unconfigured state with the setup guide and no status block", async () => {
    renderView();
    expect(await screen.findByText(t("admin.telegram.guide.step1"))).toBeTruthy();
    expect(screen.getByText(t("admin.telegram.status.notConfigured"))).toBeTruthy();
    expect(screen.queryByText(t("admin.telegram.stats.chats"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("admin.telegram.disconnect") })).toBeNull();
  });

  it("submits the token through the api and then shows the bot status", async () => {
    const user = userEvent.setup();
    renderView();
    const input = await screen.findByLabelText(t("admin.telegram.token.label"));
    expect(input.getAttribute("type")).toBe("password");
    await user.type(input, TOKEN);
    await user.click(screen.getByRole("button", { name: t("admin.telegram.token.save") }));

    await waitFor(() => {
      expect(calls("PUT", "/admin/telegram/token")).toHaveLength(1);
    });
    const body = JSON.parse(String(calls("PUT", "/admin/telegram/token")[0]?.[1]?.body)) as {
      token: string;
    };
    expect(body.token).toBe(TOKEN);
    expect(await screen.findByText("@wasfa_bot")).toBeTruthy();
    expect(screen.queryByDisplayValue(TOKEN)).toBeNull();
  });

  it("shows the status, webhook health and stats when configured", async () => {
    current = configured;
    renderView();
    expect(await screen.findByText("@wasfa_bot")).toBeTruthy();
    expect(screen.getByText(t("admin.telegram.webhook.ok"))).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(await screen.findByDisplayValue("Hello")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("admin.telegram.disconnect") })).toBeTruthy();
  });

  it("shows the last webhook error when the webhook is unhealthy", async () => {
    current = { ...configured, webhookOk: false, lastError: "Wrong response from the webhook" };
    renderView();
    expect(await screen.findByText(t("admin.telegram.webhook.error"))).toBeTruthy();
    expect(
      screen.getByText(
        t("admin.telegram.webhook.lastError", { error: "Wrong response from the webhook" }),
      ),
    ).toBeTruthy();
  });
});
