// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { type AdminWhatsappStatus } from "@wasfa/shared/schemas/admin";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WhatsappView,
  formatCountdown,
  isPairingActive,
  PAIRING_POLL_MS,
} from "../src/components/admin/whatsapp-view";
import { ReauthProvider } from "../src/lib/reauth";

const NUMBER = "+201555000111";
const CODE = "ABCD1234";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let current: AdminWhatsappStatus;

function status(overrides: Partial<AdminWhatsappStatus> = {}): AdminWhatsappStatus {
  return {
    number: null,
    numberSource: null,
    bridge: { status: "logged_out", lastBeatAt: new Date(Date.now() - 5_000).toISOString() },
    pairing: null,
    phoneVerification: "whatsapp_inbound",
    available: false,
    unavailableReason: "bridge_down",
    customerMessages: {
      enabled: false,
      dailyCap: 300,
      perUserDailyCap: 3,
      timezone: "Africa/Cairo",
      startHour: 9,
      endHour: 21,
      sentToday: 0,
    },
    ...overrides,
  };
}

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => {
    return String(url).endsWith(path) && (init?.method ?? "GET") === method;
  });

beforeEach(() => {
  fetchMock.mockReset();
  current = status();
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/admin/whatsapp") && method === "GET") {
      return Promise.resolve(json(current));
    }
    if (path.endsWith("/admin/whatsapp/link")) return Promise.resolve(json({ id: "cmd-1" }, 202));
    if (path.endsWith("/admin/whatsapp/unlink")) return Promise.resolve(json({ id: "cmd-2" }, 202));
    if (
      path.endsWith("/admin/whatsapp/verification") ||
      path.endsWith("/admin/whatsapp/customer-messages")
    ) {
      return Promise.resolve(json(current));
    }
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderView(canWrite = true) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <WhatsappView canWrite={canWrite} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("the status card", () => {
  it("says the bridge is down, with no number configured, and disables linking", async () => {
    current = status({ bridge: { status: "down", lastBeatAt: null } });
    renderView();
    expect(await screen.findByText(t("admin.whatsapp.status.down"))).toBeTruthy();
    expect(screen.getByText(t("admin.whatsapp.status.noNumber"))).toBeTruthy();
    expect(screen.getByText(t("admin.whatsapp.status.noBeat"))).toBeTruthy();
    expect(screen.getByText(t("admin.whatsapp.link.blockedDown"))).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: t("admin.whatsapp.link.submit") })
        .disabled,
    ).toBe(true);
  });

  it("shows a linked number as connected, left-to-right, with an unlink button and no link form", async () => {
    current = status({
      number: NUMBER,
      numberSource: "setting",
      bridge: { status: "connected", lastBeatAt: new Date().toISOString() },
      available: true,
    });
    delete current.unavailableReason;
    renderView();
    expect(await screen.findByText(t("admin.whatsapp.status.connected"))).toBeTruthy();
    const number = screen.getByText(NUMBER);
    expect(number.closest("[dir='ltr']")).toBeTruthy();
    expect(screen.getByText(t("admin.whatsapp.status.available"))).toBeTruthy();
    expect(screen.getByRole("button", { name: t("admin.whatsapp.unlink.button") })).toBeTruthy();
    expect(screen.queryByRole("form", { name: t("admin.whatsapp.link.title") })).toBeNull();
  });

  it("offers the link form when logged out, and nothing to change to a read-only viewer", async () => {
    renderView();
    expect(await screen.findByRole("form", { name: t("admin.whatsapp.link.title") })).toBeTruthy();
    expect(screen.getByText(t("admin.whatsapp.status.unavailable.bridge_down"))).toBeTruthy();
  });

  it("hides every write control from a read-only viewer", async () => {
    current = status({ bridge: { status: "connected", lastBeatAt: new Date().toISOString() } });
    renderView(false);
    expect(await screen.findByText(t("admin.whatsapp.readOnlyNote"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("admin.whatsapp.unlink.button") })).toBeNull();
    expect(screen.queryByRole("form", { name: t("admin.whatsapp.link.title") })).toBeNull();
    for (const toggle of screen.getAllByRole<HTMLInputElement>("switch")) {
      expect(toggle.disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: t("admin.whatsapp.customer.save") })).toBeNull();
  });
});

describe("linking", () => {
  it("sends the number as E.164 and then shows the requested state", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.whatsapp.link.title") });
    await userEvent.type(screen.getByPlaceholderText(t("phone.numberPlaceholder")), "01555000111");
    // What the API will answer once the command is queued; the page reloads right after the POST.
    current = status({ pairing: { id: "cmd-1", cmd: "link", state: "requested" } });
    await userEvent.click(screen.getByRole("button", { name: t("admin.whatsapp.link.submit") }));

    await waitFor(() => {
      expect(calls("POST", "/admin/whatsapp/link")).toHaveLength(1);
    });
    const init = calls("POST", "/admin/whatsapp/link")[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ number: NUMBER });

    expect(await screen.findByText(t("admin.whatsapp.pairing.requested"))).toBeTruthy();
  });

  it("refuses an invalid number without calling the API", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.whatsapp.link.title") });
    await userEvent.type(screen.getByPlaceholderText(t("phone.numberPlaceholder")), "12");
    await userEvent.click(screen.getByRole("button", { name: t("admin.whatsapp.link.submit") }));
    expect(await screen.findByText(t("form.invalidPhone"))).toBeTruthy();
    expect(calls("POST", "/admin/whatsapp/link")).toHaveLength(0);
  });
});

describe("the pairing code", () => {
  const withCode = (ms = 150_000) =>
    status({
      bridge: { status: "connecting", lastBeatAt: new Date().toISOString() },
      pairing: {
        id: "cmd-1",
        cmd: "link",
        state: "code",
        code: CODE,
        number: "••••0111",
        expiresAt: inFuture(ms),
      },
    });

  it("shows the code big and left-to-right, the five steps in order and a countdown", async () => {
    current = withCode();
    renderView();
    const code = await screen.findByTestId("pairing-code");
    expect(code.textContent).toBe("ABCD-1234");
    expect(code.getAttribute("dir")).toBe("ltr");

    const steps = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toEqual([
      t("admin.whatsapp.pairing.step1"),
      t("admin.whatsapp.pairing.step2"),
      t("admin.whatsapp.pairing.step3"),
      t("admin.whatsapp.pairing.step4"),
      t("admin.whatsapp.pairing.step5"),
    ]);
    expect(screen.getByRole("timer").textContent).toContain("2:");
    // The link form is not offered while a code is out.
    expect(screen.queryByRole("form", { name: t("admin.whatsapp.link.title") })).toBeNull();
  });

  it("copies the code without the hyphen", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    current = withCode();
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: t("admin.whatsapp.pairing.copy") }),
    );
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(await screen.findByText(t("common.copied"))).toBeTruthy();
  });

  it("counts down and, once expired, hides the code and offers a new one", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    current = withCode(3_000);
    renderView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("pairing-code")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.queryByTestId("pairing-code")).toBeNull();
    expect(screen.getByText(t("admin.whatsapp.pairing.expired"))).toBeTruthy();
  });

  it("polls every two seconds while the code is out and stops at linked", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    current = withCode();
    renderView();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const after = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    const reads = () => calls("GET", "/admin/whatsapp").length;

    const initial = reads();
    await after(PAIRING_POLL_MS);
    await after(PAIRING_POLL_MS);
    expect(reads()).toBeGreaterThanOrEqual(initial + 2);

    // The bridge reports success: the next poll shows it...
    current = status({
      number: NUMBER,
      numberSource: "setting",
      bridge: { status: "connected", lastBeatAt: new Date().toISOString() },
      available: true,
      pairing: { id: "cmd-1", cmd: "link", state: "linked" },
    });
    await after(PAIRING_POLL_MS);
    expect(screen.getByText(t("admin.whatsapp.pairing.linked"))).toBeTruthy();
    expect(screen.queryByTestId("pairing-code")).toBeNull();

    // ...and the fast polling ends.
    const settled = reads();
    await after(PAIRING_POLL_MS * 4);
    expect(reads()).toBe(settled);
  });

  it("explains a failed pairing in Arabic and lets the admin close it", async () => {
    current = status({
      pairing: { id: "cmd-1", cmd: "link", state: "error", reason: "timeout" },
    });
    renderView();
    expect(await screen.findByText(t("admin.whatsapp.pairing.error.timeout"))).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.whatsapp.pairing.dismiss") }),
    );
    expect(screen.queryByText(t("admin.whatsapp.pairing.error.timeout"))).toBeNull();
  });
});

describe("isPairingActive / formatCountdown", () => {
  it("is active while requested or while a code is valid", () => {
    const now = Date.now();
    expect(isPairingActive(null, now)).toBe(false);
    expect(isPairingActive({ id: "a", cmd: "link", state: "requested" }, now)).toBe(true);
    expect(
      isPairingActive(
        { id: "a", cmd: "link", state: "code", code: CODE, expiresAt: inFuture(5_000) },
        now,
      ),
    ).toBe(true);
    expect(
      isPairingActive(
        { id: "a", cmd: "link", state: "code", code: CODE, expiresAt: inFuture(-5_000) },
        now,
      ),
    ).toBe(false);
    for (const state of ["linked", "error", "unlinked", "already_linked"] as const) {
      expect(isPairingActive({ id: "a", cmd: "link", state }, now)).toBe(false);
    }
  });

  it("formats minutes and seconds", () => {
    expect(formatCountdown(125_000)).toBe("2:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("unlinking and the verification switch", () => {
  it("asks first, then queues the unlink", async () => {
    current = status({ bridge: { status: "connected", lastBeatAt: new Date().toISOString() } });
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: t("admin.whatsapp.unlink.button") }),
    );
    expect(calls("POST", "/admin/whatsapp/unlink")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.whatsapp.unlink.confirm") }),
    );
    await waitFor(() => {
      expect(calls("POST", "/admin/whatsapp/unlink")).toHaveLength(1);
    });
  });

  it("asks before switching verification off, and switches it on without asking", async () => {
    renderView();
    const toggle = await screen.findByRole<HTMLInputElement>("switch", {
      name: t("admin.whatsapp.verification.label"),
    });
    expect(toggle.checked).toBe(true);

    await userEvent.click(toggle);
    expect(calls("PUT", "/admin/whatsapp/verification")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.whatsapp.verification.offConfirm") }),
    );
    await waitFor(() => {
      expect(calls("PUT", "/admin/whatsapp/verification")).toHaveLength(1);
    });
    expect(JSON.parse(String(calls("PUT", "/admin/whatsapp/verification")[0]?.[1]?.body))).toEqual({
      enabled: false,
    });
  });

  it("turns verification on straight away when it is off", async () => {
    current = status({ phoneVerification: "disabled" });
    renderView();
    const toggle = await screen.findByRole<HTMLInputElement>("switch", {
      name: t("admin.whatsapp.verification.label"),
    });
    expect(toggle.checked).toBe(false);
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(calls("PUT", "/admin/whatsapp/verification")).toHaveLength(1);
    });
    expect(JSON.parse(String(calls("PUT", "/admin/whatsapp/verification")[0]?.[1]?.body))).toEqual({
      enabled: true,
    });
  });
});

describe("customer messages on WhatsApp", () => {
  const customerSwitch = () =>
    screen.findByRole<HTMLInputElement>("switch", { name: t("admin.whatsapp.customer.label") });

  it("asks before turning them on, warns about the ban risk, and sends the caps and hours", async () => {
    renderView();
    expect(await screen.findByText(t("admin.whatsapp.customer.risk"))).toBeTruthy();
    const toggle = await customerSwitch();
    expect(toggle.checked).toBe(false);
    await userEvent.click(toggle);
    expect(calls("PUT", "/admin/whatsapp/customer-messages")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.whatsapp.customer.onConfirm") }),
    );
    await waitFor(() => {
      expect(calls("PUT", "/admin/whatsapp/customer-messages")).toHaveLength(1);
    });
    expect(
      JSON.parse(String(calls("PUT", "/admin/whatsapp/customer-messages")[0]?.[1]?.body)),
    ).toEqual({ enabled: true, dailyCap: 300, perUserDailyCap: 3, startHour: 9, endHour: 21 });
  });

  it("shows today's count and refuses hours that end before they start", async () => {
    current = status({
      customerMessages: {
        enabled: true,
        dailyCap: 50,
        perUserDailyCap: 2,
        timezone: "Africa/Cairo",
        startHour: 9,
        endHour: 21,
        sentToday: 12,
      },
    });
    renderView();
    expect(
      await screen.findByText(t("admin.whatsapp.customer.sentToday", { sent: "12", cap: "50" })),
    ).toBeTruthy();
    const end = screen.getByRole<HTMLInputElement>("textbox", {
      name: (name) => name.includes(t("admin.whatsapp.customer.endHour")),
    });
    await userEvent.clear(end);
    await userEvent.type(end, "8");
    await userEvent.click(screen.getByRole("button", { name: t("admin.whatsapp.customer.save") }));
    expect(await screen.findByText(t("admin.whatsapp.customer.hoursOrder"))).toBeTruthy();
    expect(calls("PUT", "/admin/whatsapp/customer-messages")).toHaveLength(0);
  });
});
