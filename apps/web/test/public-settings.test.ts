import { settingDefault } from "@wasfa/shared/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server build; the module under test is server code by design.
vi.mock("server-only", () => ({}));

const { PUBLIC_SETTINGS_FALLBACK, PUBLIC_SETTINGS_TIMEOUT_MS, getPublicSettings } =
  await import("../src/lib/public-settings");

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPublicSettings", () => {
  it("falls back to the registry defaults, which hide every contact channel and social", () => {
    expect(PUBLIC_SETTINGS_FALLBACK.contact).toEqual(settingDefault("contact"));
    expect(PUBLIC_SETTINGS_FALLBACK.contact).toEqual({
      whatsapp: null,
      telegram: null,
      phone: null,
      email: null,
    });
    expect(Object.values(PUBLIC_SETTINGS_FALLBACK.socials).every((url) => url === null)).toBe(true);
    expect(PUBLIC_SETTINGS_FALLBACK.branding.nameAr).toBe(settingDefault("branding").nameAr);
  });

  it("returns what the API sends when it answers", async () => {
    const served = {
      ...PUBLIC_SETTINGS_FALLBACK,
      contact: { ...PUBLIC_SETTINGS_FALLBACK.contact, telegram: "wasfa_support" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(served)));
    expect((await getPublicSettings()).contact.telegram).toBe("wasfa_support");
  });

  it("asks with a short timeout so a slow API cannot hold a page back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PUBLIC_SETTINGS_FALLBACK));
    vi.stubGlobal("fetch", fetchMock);
    await getPublicSettings();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(PUBLIC_SETTINGS_TIMEOUT_MS).toBe(2_000);
  });

  it("uses the defaults when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getPublicSettings()).toEqual(PUBLIC_SETTINGS_FALLBACK);
  });

  it("uses the defaults when the request times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    expect(await getPublicSettings()).toEqual(PUBLIC_SETTINGS_FALLBACK);
  });

  it("uses the defaults when the API answers an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: "INTERNAL" }, { status: 500 })),
    );
    expect(await getPublicSettings()).toEqual(PUBLIC_SETTINGS_FALLBACK);
  });

  it("uses the defaults when the body is not the public settings shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })));
    expect(await getPublicSettings()).toEqual(PUBLIC_SETTINGS_FALLBACK);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    expect(await getPublicSettings()).toEqual(PUBLIC_SETTINGS_FALLBACK);
  });
});
