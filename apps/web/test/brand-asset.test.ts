import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a server build; the module under test is server code by design.
vi.mock("server-only", () => ({}));

const { BRAND_ASSETS, brandAssetResponse, brandEtag } = await import("../src/lib/brand-asset");

const request = (headers?: Record<string, string>) =>
  new Request("https://wasfa.test/icon-192.png", { headers: headers ?? {} });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("brandAssetResponse", () => {
  it("serves the bundled default when the api has no override", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const response = await brandAssetResponse(request(), BRAND_ASSETS.icon192);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // PNG signature, and within the 20 KB icon budget
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeLessThanOrEqual(20 * 1024);
    expect(response.headers.get("etag")).toBe(brandEtag(bytes));
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it("falls back to the default when the api is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const response = await brandAssetResponse(request(), BRAND_ASSETS.favicon);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/x-icon");
  });

  it("serves the admin override when its type fits, with its own ETag", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(svg, { headers: { "Content-Type": "image/svg+xml" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await brandAssetResponse(request(), BRAND_ASSETS.icon);
    expect(await response.text()).toBe(svg);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/assets\/symbol$/);
    expect(response.headers.get("etag")).toBe(brandEtag(new TextEncoder().encode(svg)));
  });

  it("ignores an override of the wrong type (a PNG symbol never becomes /icon.svg)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("png", { headers: { "Content-Type": "image/png" } })),
    );
    const response = await brandAssetResponse(request(), BRAND_ASSETS.icon);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const first = await brandAssetResponse(request(), BRAND_ASSETS.appleTouchIcon);
    const etag = first.headers.get("etag") ?? "";
    const second = await brandAssetResponse(
      request({ "If-None-Match": `W/${etag}` }),
      BRAND_ASSETS.appleTouchIcon,
    );
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });
});
