// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BANNER_CLOSED_KEY, BottomBanner } from "../src/components/ads/bottom-banner";

import type { AdSlotView } from "@wasfa/shared/ads";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const slot: AdSlotView = {
  creativeId: "0190a000-0000-7000-8000-000000000001",
  token: "tok",
  placement: "global.bottom_banner",
  format: "bottom_banner",
  sizeDesktop: "728x90",
  sizeMobile: "320x50",
  closable: true,
  dismissDays: 7,
  creative: { title: "Offer", alt: "Offer", image: null, advertiserName: null },
};

const mount = (pageClass: "marketing" | "content" | "app_neutral" = "marketing") =>
  render(
    <BottomBanner slot={slot} pageClass={pageClass} label="إعلان" closeLabel="إغلاق الإعلان" />,
  );

beforeEach(() => {
  pathname = "/";
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("BottomBanner", () => {
  it("shows the labelled banner with a spacer of equal height at the end of the page", async () => {
    mount();
    const banner = await screen.findByTestId("bottom-banner");
    expect(banner.getAttribute("aria-label")).toBe("إعلان");
    expect(screen.getByTestId("bottom-banner-spacer")).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("rel")).toBe("sponsored noopener");
    expect(link.getAttribute("href")).toBe("/a/tok");
  });

  it("renders nothing while a stored dismissal is still in the future", async () => {
    window.localStorage.setItem(BANNER_CLOSED_KEY, String(Date.now() + 60_000));
    mount();
    await act(async () => undefined);
    expect(screen.queryByTestId("bottom-banner")).toBeNull();
    expect(screen.queryByTestId("bottom-banner-spacer")).toBeNull();
  });

  it("shows again once the dismissal has expired", async () => {
    window.localStorage.setItem(BANNER_CLOSED_KEY, String(Date.now() - 1));
    mount();
    expect(await screen.findByTestId("bottom-banner")).toBeTruthy();
  });

  it("closes with one tap, removes the spacer and remembers it for dismissDays", async () => {
    mount();
    const before = Date.now();
    await userEvent.click(await screen.findByRole("button", { name: "إغلاق الإعلان" }));
    expect(screen.queryByTestId("bottom-banner")).toBeNull();
    expect(screen.queryByTestId("bottom-banner-spacer")).toBeNull();
    const until = Number(window.localStorage.getItem(BANNER_CLOSED_KEY));
    expect(until).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
  });

  it("still opens and closes when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "إغلاق الإعلان" }));
    expect(screen.queryByTestId("bottom-banner")).toBeNull();
  });

  it("renders nothing on the floor classes, whatever the server sent", async () => {
    for (const path of ["/checkout", "/analyze/0190a000", "/pricing", "/account", "/login"]) {
      pathname = path;
      const { unmount } = mount();
      await act(async () => undefined);
      expect(screen.queryByTestId("bottom-banner"), path).toBeNull();
      unmount();
    }
  });

  it("hides when client navigation moves to another class than the one it was rendered for", async () => {
    pathname = "/blog/post";
    mount("marketing");
    await act(async () => undefined);
    expect(screen.queryByTestId("bottom-banner")).toBeNull();
    pathname = "/blog/post";
    const { unmount } = mount("content");
    expect(await screen.findByTestId("bottom-banner")).toBeTruthy();
    unmount();
  });
});
