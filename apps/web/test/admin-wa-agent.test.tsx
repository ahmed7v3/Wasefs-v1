// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { waAgentSettingsSchema } from "@wasfa/shared/settings";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WaAgentView } from "../src/components/admin/wa-agent-view";
import { ReauthProvider } from "../src/lib/reauth";
import {
  formatUsdMicros,
  mediaKeyFrom,
  microsFromUsdText,
  usdTextFromMicros,
} from "../src/lib/wa-agent-format";

import type {
  WaAgentAdminSettings,
  WaAgentConversation,
  WaAgentMessage,
  WaAgentUsage,
} from "@wasfa/shared/schemas/admin-wa-agent";

const SECRET = "xi-secret-key-0123456789abcdef";
const CONVERSATION_ID = "0190a000-0000-7000-8000-000000000001";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let adminSettings: WaAgentAdminSettings;
let conversation: WaAgentConversation;
let messages: WaAgentMessage[];
let usage: WaAgentUsage;

function message(overrides: Partial<WaAgentMessage>): WaAgentMessage {
  return {
    id: "0190a000-0000-7000-8000-0000000000aa",
    direction: "in",
    kind: "text",
    text: "hello",
    status: "received",
    dropReason: null,
    tools: [],
    hasMedia: false,
    createdAt: "2026-10-26T10:00:00.000Z",
    ...overrides,
  };
}

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes(path) && (init?.method ?? "GET") === method,
  );

beforeEach(() => {
  fetchMock.mockReset();
  adminSettings = {
    settings: waAgentSettingsSchema.parse({ persona: "نص الشخصية" }),
    voiceKey: { set: false, hint: null, updatedAt: null },
    verification: { mode: "whatsapp_inbound" },
  };
  conversation = {
    id: CONVERSATION_ID,
    phone: "+••••••••4567",
    user: { id: "0190a000-0000-7000-8000-0000000000bb", name: "Sara" },
    status: "active",
    pausedUntil: null,
    lastInboundAt: "2026-10-26T10:00:00.000Z",
    lastOutboundAt: null,
    preview: "hello",
  };
  messages = [];
  usage = {
    days: [
      {
        day: "2026-10-25",
        inbound: 4,
        outboundSent: 3,
        dropped: { cap_chat_hour: 1 },
        conversations: 2,
        linkedConversations: 1,
        guestConversations: 1,
        costUsdMicros: 1_500_000,
      },
      {
        day: "2026-10-26",
        inbound: 2,
        outboundSent: 2,
        dropped: {},
        conversations: 1,
        linkedConversations: 1,
        guestConversations: 0,
        costUsdMicros: 4_000_000,
      },
    ],
    today: { spendUsdMicros: 4_000_000, spendCapUsdMicros: 5_000_000 },
  };
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.includes("/admin/wa-agent/settings") && method === "GET") {
      return Promise.resolve(json(adminSettings));
    }
    if (path.includes("/admin/wa-agent/settings") && method === "PUT") {
      return Promise.resolve(json(adminSettings));
    }
    if (path.includes("/admin/wa-agent/voice-key") && method === "PUT") {
      adminSettings = {
        ...adminSettings,
        voiceKey: { set: true, hint: "xi-…cdef", updatedAt: "2026-10-26T10:00:00.000Z" },
      };
      return Promise.resolve(json(adminSettings.voiceKey));
    }
    if (path.includes("/admin/wa-agent/voice-key") && method === "DELETE") {
      adminSettings = { ...adminSettings, voiceKey: { set: false, hint: null, updatedAt: null } };
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (path.includes("/admin/wa-agent/voice-test") && method === "POST") {
      return Promise.resolve(
        json({
          url: "https://files.example/clip.ogg",
          mime: "audio/ogg",
          chars: 12,
          expiresInSeconds: 60,
        }),
      );
    }
    if (path.includes("/media-url")) {
      return Promise.resolve(
        json({ url: "https://files.example/signed", mime: "image/jpeg", expiresInSeconds: 60 }),
      );
    }
    if (path.includes("/messages") && method === "GET") {
      return Promise.resolve(json({ items: messages, nextCursor: null }));
    }
    if (path.includes("/pause") && method === "POST") {
      return Promise.resolve(
        json({ id: CONVERSATION_ID, status: "paused", pausedUntil: "2026-10-26T12:00:00.000Z" }),
      );
    }
    if (path.includes("/admin/wa-agent/conversations") && method === "GET") {
      return Promise.resolve(json({ items: [conversation], nextCursor: null }));
    }
    if (path.includes("/admin/wa-agent/usage")) return Promise.resolve(json(usage));
    if (path.includes("/admin/plans")) return Promise.resolve(json({ items: [] }));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderView(props: { canWrite?: boolean; canInbox?: boolean } = {}) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <WaAgentView
          canWrite={props.canWrite ?? true}
          canInbox={props.canInbox ?? true}
          canReadPlans={false}
        />
      </ReauthProvider>
    </ToastProvider>,
  );
}

describe("format helpers", () => {
  it("converts the spend cap between dollars and micros", () => {
    expect(usdTextFromMicros(5_000_000)).toBe("5.00");
    expect(microsFromUsdText("5.25")).toBe(5_250_000);
    expect(microsFromUsdText("0,5")).toBe(500_000);
    expect(microsFromUsdText("abc")).toBeNaN();
    expect(microsFromUsdText("-1")).toBeNaN();
    expect(formatUsdMicros(1_500_000)).toBe("$1.50");
    expect(formatUsdMicros(2_500)).toBe("$0.0025");
  });

  it("makes unique media keys that satisfy the settings pattern", () => {
    expect(mediaKeyFrom("Bank Details.PNG", new Set())).toBe("bank-details");
    expect(mediaKeyFrom("bank-details", new Set(["bank-details"]))).toBe("bank-details-2");
    expect(mediaKeyFrom(null, new Set())).toBe("media");
    expect(mediaKeyFrom("صورة.png", new Set())).toBe("media");
  });
});

describe("the Settings tab", () => {
  it("shows the saved values and the separate codes switch", async () => {
    renderView();
    expect(
      await screen.findByRole("form", { name: t("admin.waAgent.settings.title") }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue("نص الشخصية")).toBeTruthy();
    expect(
      screen.getByText(t("admin.waAgent.persona.count", { count: 10, max: 4000 })),
    ).toBeTruthy();
    expect(screen.getByText(t("admin.waAgent.status.codesOn"), { exact: false })).toBeTruthy();
    const link = screen.getByRole("link", { name: t("admin.waAgent.status.codesLink") });
    expect(link.getAttribute("href")).toBe("/admin/whatsapp");
    // The cap is shown in dollars, stored in micros.
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: /سقف إنفاق الوكيل/ }).value).toBe(
      "5.00",
    );
  });

  it("saves the whole form with the changed switch and persona", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    await userEvent.click(screen.getByRole("switch", { name: t("admin.waAgent.status.enabled") }));
    await userEvent.type(screen.getByDisplayValue("نص الشخصية"), " إضافي");
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.save") }));
    await waitFor(() => {
      expect(calls("PUT", "/admin/wa-agent/settings")).toHaveLength(1);
    });
    const [, init] = calls("PUT", "/admin/wa-agent/settings")[0] ?? [];
    const body = JSON.parse(String(init?.body)) as { enabled: boolean; persona: string };
    expect(body.enabled).toBe(true);
    expect(body.persona).toBe("نص الشخصية إضافي");
    expect(waAgentSettingsSchema.safeParse(body).success).toBe(true);
  });

  it("does not save an out-of-range value and marks the field", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    const delay = screen.getByRole("textbox", { name: t("admin.waAgent.timing.delay") });
    await userEvent.clear(delay);
    await userEvent.type(delay, "99");
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.save") }));
    expect(await screen.findByText(t("admin.waAgent.fixErrors"))).toBeTruthy();
    expect(calls("PUT", "/admin/wa-agent/settings")).toHaveLength(0);
  });

  it("never shows the voice key: it goes in once, then only the hint is shown", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    expect(screen.getByText(t("admin.waAgent.voiceKey.notSet"))).toBeTruthy();

    const input = screen.getByLabelText<HTMLInputElement>(t("admin.waAgent.voiceKey.input"));
    expect(input.type).toBe("password");
    await userEvent.type(input, SECRET);
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.voiceKey.save") }));

    await waitFor(() => {
      expect(calls("PUT", "/admin/wa-agent/voice-key")).toHaveLength(1);
    });
    const [, init] = calls("PUT", "/admin/wa-agent/voice-key")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({ apiKey: SECRET });
    // The saved state shows the hint; the input is empty and the key is nowhere in the page.
    expect(await screen.findByText(t("admin.waAgent.voiceKey.set"), { exact: false })).toBeTruthy();
    expect(screen.getByText("xi-…cdef")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(t("admin.waAgent.voiceKey.input")).value).toBe(
      "",
    );
    expect(document.body.innerHTML).not.toContain(SECRET);
    // The settings save never carries it either.
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.save") }));
    await waitFor(() => {
      expect(calls("PUT", "/admin/wa-agent/settings")).toHaveLength(1);
    });
    expect(String(calls("PUT", "/admin/wa-agent/settings")[0]?.[1]?.body)).not.toContain(SECRET);
  });

  it("explains why the voice cannot be tested before a key and a voice id are saved", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    expect(screen.getByText(t("admin.waAgent.voice.test.noKey"))).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: t("admin.waAgent.voice.test.run") })
        .disabled,
    ).toBe(true);
    expect(calls("POST", "/admin/wa-agent/voice-test")).toHaveLength(0);
  });

  it("tests the saved voice and plays the returned link", async () => {
    adminSettings = {
      ...adminSettings,
      settings: waAgentSettingsSchema.parse({ voice: { voiceId: "voice123" } }),
      voiceKey: { set: true, hint: "xi-…cdef", updatedAt: "2026-10-26T10:00:00.000Z" },
    };
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    await userEvent.type(screen.getByLabelText(t("admin.waAgent.voice.test.text")), "اهلا بيك");
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.voice.test.run") }));
    await waitFor(() => {
      expect(calls("POST", "/admin/wa-agent/voice-test")).toHaveLength(1);
    });
    expect(JSON.parse(String(calls("POST", "/admin/wa-agent/voice-test")[0]?.[1]?.body))).toEqual({
      text: "اهلا بيك",
    });
    const player = await screen.findByLabelText(t("admin.waAgent.voice.test.player"));
    expect(player.getAttribute("src")).toBe("https://files.example/clip.ogg");
  });

  it("sends the optional voice numbers only when they are filled in", async () => {
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: t("admin.waAgent.voice.dailyCharCap") })
        .value,
    ).toBe("20000");
    await userEvent.type(
      screen.getByRole("textbox", { name: t("admin.waAgent.voice.stability") }),
      "0.4",
    );
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.save") }));
    await waitFor(() => {
      expect(calls("PUT", "/admin/wa-agent/settings")).toHaveLength(1);
    });
    const body = JSON.parse(String(calls("PUT", "/admin/wa-agent/settings")[0]?.[1]?.body)) as {
      voice: Record<string, unknown>;
    };
    expect(body.voice["stability"]).toBe(0.4);
    expect("similarityBoost" in body.voice).toBe(false);
  });

  it("clears the key only after a confirmation", async () => {
    adminSettings = {
      ...adminSettings,
      voiceKey: { set: true, hint: "xi-…cdef", updatedAt: "2026-10-26T10:00:00.000Z" },
    };
    renderView();
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    await userEvent.click(screen.getByRole("button", { name: t("admin.waAgent.voiceKey.clear") }));
    expect(calls("DELETE", "/admin/wa-agent/voice-key")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.waAgent.voiceKey.clearConfirm") }),
    );
    await waitFor(() => {
      expect(calls("DELETE", "/admin/wa-agent/voice-key")).toHaveLength(1);
    });
  });

  it("is read-only without the write permission", async () => {
    renderView({ canWrite: false });
    expect(await screen.findByText(t("admin.waAgent.readOnly"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("admin.waAgent.save") })).toBeNull();
    expect(screen.queryByLabelText(t("admin.waAgent.voiceKey.input"))).toBeNull();
    for (const toggle of screen.getAllByRole<HTMLInputElement>("switch")) {
      expect(toggle.disabled).toBe(true);
    }
  });
});

describe("the Inbox tab", () => {
  it("is hidden without the inbox permission and fetches no chat", async () => {
    renderView({ canInbox: false });
    await screen.findByRole("form", { name: t("admin.waAgent.settings.title") });
    expect(screen.getByRole("tab", { name: t("admin.waAgent.tab.settings") })).toBeTruthy();
    expect(screen.getByRole("tab", { name: t("admin.waAgent.tab.usage") })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: t("admin.waAgent.tab.inbox") })).toBeNull();
    expect(calls("GET", "/admin/wa-agent/conversations")).toHaveLength(0);
  });

  it("renders the transcript by direction, greys dropped replies and opens media by signed link", async () => {
    messages = [
      message({
        id: "0190a000-0000-7000-8000-0000000000a3",
        direction: "out",
        status: "dropped",
        dropReason: "cap_chat_hour",
        text: "dropped reply",
        createdAt: "2026-10-26T10:03:00.000Z",
      }),
      message({
        id: "0190a000-0000-7000-8000-0000000000a2",
        direction: "owner",
        status: "sent",
        text: "owner words",
        createdAt: "2026-10-26T10:02:00.000Z",
      }),
      message({
        id: "0190a000-0000-7000-8000-0000000000a1",
        direction: "out",
        status: "sent",
        text: "agent words",
        tools: ["get_catalog"],
        createdAt: "2026-10-26T10:01:00.000Z",
      }),
      message({
        id: "0190a000-0000-7000-8000-0000000000a0",
        direction: "in",
        kind: "image",
        text: null,
        hasMedia: true,
        createdAt: "2026-10-26T10:00:00.000Z",
      }),
    ];
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderView();
    await userEvent.click(await screen.findByRole("tab", { name: t("admin.waAgent.tab.inbox") }));
    await userEvent.click(await screen.findByRole("button", { name: /Sara/ }));

    const list = await screen.findByRole("list", { name: t("admin.waAgent.inbox.transcript") });
    const bubbles = within(list).getAllByRole("listitem");
    // Oldest first.
    expect(bubbles.map((bubble) => bubble.getAttribute("data-direction"))).toEqual([
      "in",
      "out",
      "owner",
      "out",
    ]);
    expect(
      within(bubbles[0] as HTMLElement).getByText(t("admin.waAgent.inbox.from.customer"), {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      within(bubbles[1] as HTMLElement).getByText(t("admin.waAgent.inbox.from.agent"), {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      within(bubbles[2] as HTMLElement).getByText(t("admin.waAgent.inbox.from.owner"), {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      within(bubbles[1] as HTMLElement).getByText(
        t("admin.waAgent.inbox.tools", { tools: "get_catalog" }),
      ),
    ).toBeTruthy();
    const dropped = bubbles[3] as HTMLElement;
    expect(dropped.className).toContain("opacity-60");
    expect(
      within(dropped).getByText(
        t("admin.waAgent.inbox.dropped", { reason: t("admin.waAgent.drop.cap_chat_hour") }),
      ),
    ).toBeTruthy();

    await userEvent.click(
      within(bubbles[0] as HTMLElement).getByRole("button", {
        name: t("admin.waAgent.inbox.open.image"),
      }),
    );
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        "https://files.example/signed",
        "_blank",
        "noopener,noreferrer",
      );
    });
    expect(calls("GET", "/media-url")).toHaveLength(1);
  });

  it("pauses a chat for the chosen preset and shows the new state", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("tab", { name: t("admin.waAgent.tab.inbox") }));
    await userEvent.click(await screen.findByRole("button", { name: /Sara/ }));
    await userEvent.click(
      await screen.findByRole("button", { name: t("admin.waAgent.inbox.pause") }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByRole("combobox"), "1440");
    conversation = { ...conversation, status: "paused", pausedUntil: "2026-10-26T12:00:00.000Z" };
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("admin.waAgent.inbox.pause") }),
    );
    await waitFor(() => {
      expect(calls("POST", "/pause")).toHaveLength(1);
    });
    expect(JSON.parse(String(calls("POST", "/pause")[0]?.[1]?.body))).toEqual({ minutes: 1440 });
    expect(
      await screen.findByRole("button", { name: t("admin.waAgent.inbox.resume") }),
    ).toBeTruthy();
  });

  it("offers no chat controls to a reader without the write permission", async () => {
    renderView({ canWrite: false });
    await userEvent.click(await screen.findByRole("tab", { name: t("admin.waAgent.tab.inbox") }));
    await userEvent.click(await screen.findByRole("button", { name: /Sara/ }));
    await screen
      .findByRole("list", { name: t("admin.waAgent.inbox.transcript") })
      .catch(() => null);
    await screen.findByText(t("admin.waAgent.inbox.noMessages"));
    expect(screen.queryByRole("button", { name: t("admin.waAgent.inbox.block") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("admin.waAgent.inbox.pause") })).toBeNull();
  });
});

describe("the Usage tab", () => {
  it("shows today's spend against the cap and one row per day", async () => {
    renderView();
    await userEvent.click(await screen.findByRole("tab", { name: t("admin.waAgent.tab.usage") }));
    const bar = await screen.findByRole("progressbar", { name: t("admin.waAgent.usage.today") });
    expect(bar.getAttribute("aria-valuenow")).toBe("80");
    expect(
      screen.getByText(t("admin.waAgent.usage.spendOfCap", { spend: "$4.00", cap: "$5.00" })),
    ).toBeTruthy();
    expect(screen.getAllByText("$1.50").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(`${t("admin.waAgent.drop.cap_chat_hour")}: 1`, { exact: false }).length,
    ).toBeGreaterThan(0);
  });
});
