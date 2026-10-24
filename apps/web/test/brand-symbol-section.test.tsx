// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandSymbolSection } from "../src/components/admin/brand-symbol-section";
import { ReauthProvider } from "../src/lib/reauth";

const API = "https://api.wasfa.online";
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sha = (char: string) => char.repeat(64);
const asset = (key: string, hash: string, side = 192) => ({
  key,
  contentType: "image/png",
  size: 2048,
  sha256: hash,
  width: side,
  height: side,
  url: `${API}/assets/${key}?v=${hash.slice(0, 12)}`,
  updatedAt: "2026-10-10T10:00:00.000Z",
});

let list: { items: ReturnType<typeof asset>[]; history: Record<string, number> };

beforeEach(() => {
  list = { items: [asset("symbol", sha("a"), 512), asset("icon_192", sha("b"))], history: {} };
  fetchMock.mockReset();
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `${API}/admin/branding/assets` && method === "GET") {
      return Promise.resolve(json(list));
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSection(canWrite = true) {
  render(
    <ToastProvider>
      <ReauthProvider>
        <BrandSymbolSection canWrite={canWrite} logoUrl={null} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
const user = () => userEvent.setup({ applyAccept: false });
const png = (name: string) => new File([new Uint8Array(8)], name, { type: "image/png" });

describe("BrandSymbolSection", () => {
  it("shows the symbol, every generated icon with its size, and the preview panel", async () => {
    renderSection();
    expect(
      await screen.findByRole("img", { name: t("admin.branding.symbol.currentAlt") }),
    ).toBeTruthy();
    const tile = screen.getByRole("listitem", { name: t("admin.branding.icon.icon_192") });
    expect(within(tile).getByText(/192×192/)).toBeTruthy();
    // a key with nothing stored says the default shows
    expect(screen.getAllByText(t("admin.branding.icon.missing")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("admin.branding.preview.title"))).toBeTruthy();
    for (const caption of [
      "admin.branding.preview.tabLight",
      "admin.branding.preview.tabDark",
      "admin.branding.preview.google",
      "admin.branding.preview.ios",
      "admin.branding.preview.androidCircle",
      "admin.branding.preview.androidSquircle",
      "admin.branding.preview.card",
      "admin.branding.preview.email",
    ] as const) {
      expect(screen.getByText(t(caption))).toBeTruthy();
    }
  });

  it("is read-only without the write permission", async () => {
    renderSection(false);
    await screen.findByRole("img", { name: t("admin.branding.symbol.currentAlt") });
    expect(screen.queryByRole("button", { name: t("admin.branding.symbol.choose") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("admin.branding.icon.override") })).toBeNull();
  });

  it("uploads the symbol, warns about low contrast and stops polling once an icon changes", async () => {
    renderSection();
    const picker = await screen.findByLabelText(t("admin.branding.symbol.chooseLabel"));
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === `${API}/admin/branding/assets/symbol` && method === "PUT") {
        // from now on the list shows a regenerated icon
        list = { ...list, items: [asset("symbol", sha("c"), 512), asset("icon_192", sha("d"))] };
        return Promise.resolve(
          json({ ...asset("symbol", sha("c"), 512), warnings: ["low_contrast"], generating: true }),
        );
      }
      if (url === `${API}/admin/branding/assets` && method === "GET") {
        return Promise.resolve(json(list));
      }
      return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });

    await user().upload(picker, png("symbol.png"));
    await userEvent.click(screen.getByRole("button", { name: t("admin.branding.symbol.upload") }));

    await waitFor(() => {
      expect(calls("PUT")).toHaveLength(1);
    });
    expect(JSON.parse(String(calls("PUT")[0]?.[1]?.body))).toEqual({
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/) as unknown,
    });
    expect(await screen.findByText(t("admin.branding.warning.low_contrast"))).toBeTruthy();
    expect(
      await screen.findByText(t("admin.branding.symbol.generated"), {}, { timeout: 6_000 }),
    ).toBeTruthy();

    // polling has stopped: no further reads after the status settled
    const reads = calls("GET").length;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(calls("GET").length).toBe(reads);
  }, 15_000);

  it("replaces one icon by hand and can revert it", async () => {
    list.history = { icon_192: 1 };
    renderSection();
    const tile = await screen.findByRole("listitem", { name: t("admin.branding.icon.icon_192") });
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === `${API}/admin/branding/assets/icon_192` && method === "PUT") {
        return Promise.resolve(
          json({ ...asset("icon_192", sha("e")), warnings: [], generating: false }),
        );
      }
      if (url === `${API}/admin/branding/assets/icon_192/revert` && method === "POST") {
        return Promise.resolve(
          json({ ...asset("icon_192", sha("b")), warnings: [], generating: false }),
        );
      }
      if (url === `${API}/admin/branding/assets` && method === "GET")
        return Promise.resolve(json(list));
      return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });

    const picker = within(tile).getByLabelText(
      t("admin.branding.icon.overrideLabel", { name: t("admin.branding.icon.icon_192") }),
    );
    await user().upload(picker, png("icon.png"));
    await waitFor(() => {
      expect(calls("PUT")).toHaveLength(1);
    });

    await userEvent.click(
      within(tile).getByRole("button", {
        name: t("admin.branding.icon.revertLabel", { name: t("admin.branding.icon.icon_192") }),
      }),
    );
    await waitFor(() => {
      expect(calls("POST")).toHaveLength(1);
    });
  });

  it("refuses a file of the wrong type for an icon without calling the api", async () => {
    renderSection();
    const tile = await screen.findByRole("listitem", { name: t("admin.branding.icon.icon_192") });
    const picker = within(tile).getByLabelText(
      t("admin.branding.icon.overrideLabel", { name: t("admin.branding.icon.icon_192") }),
    );
    await user().upload(picker, new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(await within(tile).findByText(t("admin.branding.error.type"))).toBeTruthy();
    expect(calls("PUT")).toHaveLength(0);
  });
});
