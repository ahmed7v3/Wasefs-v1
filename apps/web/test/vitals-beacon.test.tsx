// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VitalsBeacon } from "../src/components/vitals-beacon";

type Handler = (metric: { name: string; value: number }) => void;
const handlers = vi.hoisted(
  () => new Map<string, (metric: { name: string; value: number }) => void>(),
);

vi.mock("web-vitals", () => {
  const observer = (name: string) => (callback: Handler) => {
    handlers.set(name, callback);
  };
  return {
    onLCP: observer("LCP"),
    onINP: observer("INP"),
    onCLS: observer("CLS"),
    onFCP: observer("FCP"),
    onTTFB: observer("TTFB"),
  };
});

const ENDPOINT = "https://api.test/public/vitals";
const sendBeacon = vi.fn<(url: string, body: string) => boolean>(() => true);

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  handlers.clear();
  sendBeacon.mockClear();
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
  Object.defineProperty(window, "requestIdleCallback", {
    value: (callback: () => void) => setTimeout(callback, 0),
    configurable: true,
  });
  setVisibility("visible");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle() {
  await vi.waitFor(() => {
    expect(handlers.size).toBe(5);
  });
}

describe("VitalsBeacon", () => {
  it("does nothing on a page view outside the sample", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    render(<VitalsBeacon route="/pricing" endpoint={ENDPOINT} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlers.size).toBe(0);
    setVisibility("hidden");
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("sends every metric gathered so far, once, when the page is hidden", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    render(<VitalsBeacon route="/pricing" endpoint={ENDPOINT} />);
    await settle();

    handlers.get("LCP")?.({ name: "LCP", value: 1800 });
    handlers.get("CLS")?.({ name: "CLS", value: 0.04 });
    handlers.get("CLS")?.({ name: "CLS", value: 0.05 });
    setVisibility("visible");
    expect(sendBeacon).not.toHaveBeenCalled();

    setVisibility("hidden");
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, body] = sendBeacon.mock.calls[0] ?? [];
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(body ?? "")).toEqual({
      metrics: [
        { name: "LCP", value: 1800, route: "/pricing" },
        { name: "CLS", value: 0.05, route: "/pricing" },
      ],
    });

    // Nothing new was measured: a second hide sends nothing.
    setVisibility("visible");
    setVisibility("hidden");
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when no metric was measured", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<VitalsBeacon route="/" endpoint={ENDPOINT} />);
    await settle();
    setVisibility("hidden");
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
