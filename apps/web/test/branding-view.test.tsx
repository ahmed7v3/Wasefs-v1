// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { BRANDING_ASSET_MAX_BYTES } from "@wasfa/shared/schemas/branding";
import { settingDefault } from "@wasfa/shared/settings";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingView } from "../src/components/admin/branding-view";
import { acceptAttribute, checkAssetFile } from "../src/lib/brand-assets";
import { ReauthProvider } from "../src/lib/reauth";

const API = "https://api.wasfa.online";
const LOGO = `${API}/assets/logo?v=0123456789ab`;
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let branding: ReturnType<typeof settingDefault<"branding">>;

function settingsBody() {
  return {
    items: [
      {
        key: "branding",
        visibility: "public",
        value: branding,
        updatedAt: "2026-10-10T10:00:00.000Z",
        updatedBy: null,
      },
    ],
  };
}

const uploaded = {
  key: "logo",
  contentType: "image/png",
  size: 10,
  sha256: "a".repeat(64),
  width: 240,
  height: 80,
  url: LOGO,
};

beforeEach(() => {
  branding = { ...settingDefault("branding"), logoUrl: LOGO, logoWidth: 240, logoHeight: 80 };
  fetchMock.mockReset();
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === `${API}/admin/settings` && method === "GET")
      return Promise.resolve(json(settingsBody()));
    return Promise.reject(new Error(`unexpected ${method} ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderView(canWrite = true) {
  render(
    <ToastProvider>
      <ReauthProvider>
        <BrandingView canWrite={canWrite} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);

/** The user-event instance: the file input's `accept` would hide the wrong types the tests send. */
const user = () => userEvent.setup({ applyAccept: false });

const pngFile = (name = "logo.png", bytes = 8) =>
  new File([new Uint8Array(bytes)], name, { type: "image/png" });

describe("checkAssetFile", () => {
  it("takes the favicon types and the logo types, by MIME type or by extension", () => {
    expect(checkAssetFile("logo", pngFile())).toEqual({ ok: true, type: "image/png" });
    expect(
      checkAssetFile("logo", new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })),
    ).toEqual({
      ok: true,
      type: "image/svg+xml",
    });
    // Windows reports icons under another name, or none
    expect(
      checkAssetFile("favicon", new File(["x"], "f.ico", { type: "image/vnd.microsoft.icon" })),
    ).toEqual({ ok: true, type: "image/x-icon" });
    expect(checkAssetFile("favicon", new File(["x"], "f.ico", { type: "" }))).toEqual({
      ok: true,
      type: "image/x-icon",
    });
    expect(acceptAttribute("favicon")).toContain(".ico");
    expect(acceptAttribute("logo")).not.toContain("ico");
  });

  it("refuses other types, an ICO as a logo, empty files and files over 512 KB", () => {
    expect(checkAssetFile("logo", new File(["x"], "a.gif", { type: "image/gif" }))).toEqual({
      ok: false,
      reason: "type",
    });
    expect(checkAssetFile("logo", new File(["x"], "a.ico", { type: "image/x-icon" }))).toEqual({
      ok: false,
      reason: "type",
    });
    expect(checkAssetFile("logo", pngFile("a.png", 0))).toEqual({ ok: false, reason: "type" });
    expect(checkAssetFile("logo", pngFile("a.png", BRANDING_ASSET_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: "size",
    });
    expect(checkAssetFile("logo", pngFile("a.png", BRANDING_ASSET_MAX_BYTES))).toMatchObject({
      ok: true,
    });
  });
});

describe("BrandingView", () => {
  it("previews the current logo and says so when there is no favicon", async () => {
    renderView();
    const current = await screen.findByRole("img", {
      name: t("admin.branding.currentAlt", { name: t("admin.branding.logo.title") }),
    });
    expect(current.getAttribute("src")).toBe(LOGO);
    expect(screen.getAllByText(t("admin.branding.none"))).toHaveLength(1);
  });

  it("is read-only without the write permission", async () => {
    renderView(false);
    await screen.findByText(t("admin.branding.readOnlyNote"));
    expect(screen.queryByRole("button", { name: t("admin.branding.choose") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("common.save") })).toBeNull();
    expect(
      (screen.getByLabelText(t("admin.settings.field.branding.nameAr")) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it("rejects a file of the wrong type or over 512 KB without calling the API", async () => {
    renderView();
    const picker = await screen.findByLabelText(
      t("admin.branding.chooseFor", { name: t("admin.branding.logo.title") }),
    );

    await user().upload(picker, new File(["GIF89a"], "a.gif", { type: "image/gif" }));
    expect(await screen.findByText(t("admin.branding.error.type"))).toBeTruthy();

    await user().upload(picker, pngFile("big.png", BRANDING_ASSET_MAX_BYTES + 1));
    expect(await screen.findByText(t("admin.branding.error.size"))).toBeTruthy();
    expect(screen.queryByText(t("admin.branding.error.type"))).toBeNull();

    expect(calls("PUT")).toHaveLength(0);
    expect(
      (screen.getAllByRole("button", { name: t("admin.branding.upload") })[0] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("previews the chosen file, uploads it as a data URL and reloads the settings", async () => {
    renderView();
    const picker = await screen.findByLabelText(
      t("admin.branding.chooseFor", { name: t("admin.branding.logo.title") }),
    );
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === `${API}/admin/branding/assets/logo` && method === "PUT") {
        return Promise.resolve(json(uploaded));
      }
      if (url === `${API}/admin/settings`) return Promise.resolve(json(settingsBody()));
      return Promise.reject(new Error(`unexpected ${method} ${url}`));
    });

    await user().upload(picker, pngFile("new-logo.png"));
    const preview = await screen.findByRole("img", { name: t("admin.branding.pickedAlt") });
    expect(preview.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText(t("admin.branding.picked", { name: "new-logo.png" }))).toBeTruthy();

    // the logo card comes first, the favicon card second
    await userEvent.click(
      screen.getAllByRole("button", { name: t("admin.branding.upload") })[0] as HTMLElement,
    );

    await waitFor(() => {
      expect(calls("PUT")).toHaveLength(1);
    });
    const [, init] = calls("PUT")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      dataUrl: expect.stringMatching(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/) as unknown,
    });
    // the settings are fetched again, and the picked preview is gone
    await waitFor(() => {
      expect(calls("GET").filter(([url]) => String(url).endsWith("/admin/settings"))).toHaveLength(
        2,
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: t("admin.branding.pickedAlt") })).toBeNull();
    });
  });

  it("explains why the api refused the file", async () => {
    renderView();
    const picker = await screen.findByLabelText(
      t("admin.branding.chooseFor", { name: t("admin.branding.logo.title") }),
    );
    fetchMock.mockImplementation((_input, init) => {
      if ((init?.method ?? "GET") === "PUT") {
        return Promise.resolve(
          json(
            {
              code: "VALIDATION_FAILED",
              message: "x",
              details: { fields: ["dataUrl"], reason: "unsafe_svg" },
            },
            400,
          ),
        );
      }
      return Promise.resolve(json(settingsBody()));
    });
    await user().upload(picker, new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    await userEvent.click(
      screen.getAllByRole("button", { name: t("admin.branding.upload") })[0] as HTMLElement,
    );
    expect(await screen.findByText(t("admin.branding.reason.unsafe_svg"))).toBeTruthy();
  });

  it("deletes the logo after a confirmation", async () => {
    renderView();
    await screen.findByRole("img", {
      name: t("admin.branding.currentAlt", { name: t("admin.branding.logo.title") }),
    });
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === `${API}/admin/branding/assets/logo` && init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(json(settingsBody()));
    });

    await userEvent.click(screen.getByRole("button", { name: t("admin.branding.delete") }));
    expect(calls("DELETE")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: t("admin.branding.delete") }));
    await waitFor(() => {
      expect(calls("DELETE")).toHaveLength(1);
    });
  });

  it("saves the names together with the stored image fields, so the logo survives", async () => {
    renderView();
    const nameAr = await screen.findByLabelText(t("admin.settings.field.branding.nameAr"));
    fetchMock.mockImplementation((input, init) => {
      if (String(input) === `${API}/admin/settings/branding` && init?.method === "PUT") {
        return Promise.resolve(json({ ...settingsBody().items[0], value: branding }));
      }
      return Promise.resolve(json(settingsBody()));
    });
    await userEvent.clear(nameAr);
    await userEvent.type(nameAr, "صيدلية النور");
    await userEvent.click(
      screen.getByRole("checkbox", { name: t("admin.settings.field.branding.showNameWithLogo") }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(calls("PUT")).toHaveLength(1);
    });
    const [, init] = calls("PUT")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      value: {
        ...branding,
        nameAr: "صيدلية النور",
        showNameWithLogo: true,
      },
    });
  });

  it("does not save an empty name", async () => {
    renderView();
    const nameAr = await screen.findByLabelText(t("admin.settings.field.branding.nameAr"));
    await userEvent.clear(nameAr);
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("form.required"))).toBeTruthy();
    expect(calls("PUT")).toHaveLength(0);
  });
});
