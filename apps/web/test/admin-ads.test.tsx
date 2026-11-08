// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdsCreativeForm } from "../src/components/admin/ads-creative-form";
import { PlacementPreview } from "../src/components/admin/ads-placements-view";
import { WhatsAppAdPreview } from "../src/components/admin/ads-wa-preview";
import {
  aspectOf,
  formatCtr,
  isoToLocalInput,
  localInputToIso,
  parseCountries,
  sizeLabel,
} from "../src/lib/ads-admin";
import { ReauthProvider } from "../src/lib/reauth";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input) =>
    Promise.resolve(
      String(input).includes("/admin/ads/advertisers") ? json({ items: [] }) : json({}, 500),
    ),
  );
});

const mountForm = () =>
  render(
    <ReauthProvider>
      <ToastProvider>
        <AdsCreativeForm creative={null} onSaved={() => undefined} onClose={() => undefined} />
      </ToastProvider>
    </ReauthProvider>,
  );

const writes = () => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET");

describe("ads console helpers", () => {
  it("formats CTR, sizes and ratios", () => {
    expect(formatCtr(0)).toBe("0%");
    expect(formatCtr(0.025)).toBe("2.5%");
    expect(formatCtr(Number.NaN)).toBe("0%");
    expect(sizeLabel("970x250")).toBe("970 × 250");
    expect(sizeLabel("native")).toBe("native");
    expect(aspectOf("970x250")).toBe("970 / 250");
    expect(aspectOf("native")).toBe("16 / 9");
  });

  it("parses countries and schedule inputs", () => {
    expect(parseCountries("eg, sa  EG ae")).toEqual(["EG", "SA", "AE"]);
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not a date")).toBeNull();
    const iso = localInputToIso("2026-11-08T10:30");
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso)).toBe("2026-11-08T10:30");
  });
});

describe("placement preview", () => {
  it("draws the desktop and mobile boxes with the aspect ratio of their size", () => {
    render(<PlacementPreview sizeDesktop="970x250" sizeMobile="320x100" format="banner" />);
    expect(screen.getByTestId("preview-desktop").style.aspectRatio).toBe("970 / 250");
    expect(screen.getByTestId("preview-mobile").style.aspectRatio).toBe("320 / 100");
    expect(screen.getByText("970 × 250")).toBeTruthy();
    expect(screen.getAllByText(t("ads.label")).length).toBeGreaterThan(0);
  });
});

describe("WhatsApp preview", () => {
  it("shows the label added by code, the text and the link", () => {
    render(<WhatsAppAdPreview text="عرض خاص" url="https://example.com/offer" />);
    expect(screen.getByTestId("wa-preview-label").textContent).toBe(t("ads.label"));
    expect(screen.getByText("عرض خاص")).toBeTruthy();
    expect(screen.getByText("example.com/offer")).toBeTruthy();
  });
});

describe("creative form", () => {
  it("shows the WhatsApp text field, counter and bubble only for the WhatsApp channel", async () => {
    mountForm();
    expect(screen.queryByTestId("wa-preview")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: t("admin.ads.channel.whatsapp") }));
    await userEvent.type(screen.getByLabelText(t("admin.ads.creative.waText")), "مرحبا");
    expect(screen.getByTestId("wa-counter").textContent).toBe("5 / 700");
    expect(screen.getByTestId("wa-preview")).toBeTruthy();
  });

  it("refuses a non-https destination before any request is made", async () => {
    mountForm();
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.ads.creative.title"))), "Offer");
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.ads.creative.alt"))), "Offer");
    const url = screen.getByLabelText(new RegExp(t("admin.ads.creative.targetUrl")));
    await userEvent.clear(url);
    await userEvent.type(url, "http://example.com");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.ads.invalid.targetUrl"))).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("requires the WhatsApp text when the channel is on", async () => {
    mountForm();
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.ads.creative.title"))), "Offer");
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.ads.creative.alt"))), "Offer");
    const url = screen.getByLabelText(new RegExp(t("admin.ads.creative.targetUrl")));
    await userEvent.clear(url);
    await userEvent.type(url, "https://example.com");
    await userEvent.click(screen.getByRole("checkbox", { name: t("admin.ads.channel.whatsapp") }));
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.ads.invalid.waText"))).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("posts a valid draft", async () => {
    fetchMock.mockImplementation((input, init) =>
      Promise.resolve(
        (init?.method ?? "GET") === "POST"
          ? json({
              id: "0190a000-0000-7000-8000-000000000001",
              advertiserId: null,
              advertiserName: null,
              title: "Offer",
              imageMediaId: null,
              imageUrl: null,
              alt: "Offer",
              targetUrl: "https://example.com",
              category: "house",
              status: "draft",
              startsAt: null,
              endsAt: null,
              weight: 100,
              targeting: {
                placements: [],
                pageClasses: [],
                devices: [],
                locales: [],
                countries: [],
              },
              channels: ["web"],
              waText: null,
              createdAt: "2026-11-08T00:00:00.000Z",
              updatedAt: "2026-11-08T00:00:00.000Z",
            })
          : String(input).includes("/advertisers")
            ? json({ items: [] })
            : json({}, 500),
      ),
    );
    mountForm();
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.ads.creative.title"))), "Offer");
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.ads.creative.alt"))), "Offer");
    const url = screen.getByLabelText(new RegExp(t("admin.ads.creative.targetUrl")));
    await userEvent.clear(url);
    await userEvent.type(url, "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    const [target, init] = writes()[0] ?? [];
    expect(String(target)).toContain("/admin/ads/creatives");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      title: "Offer",
      targetUrl: "https://example.com",
      channels: ["web"],
      waText: null,
    });
  });
});
