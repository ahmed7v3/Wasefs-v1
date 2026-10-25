import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  value: null as null | { redirects: Record<string, string>; gone: string[] },
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/content-api", () => ({
  getPublicPathState: () =>
    state.value ? Promise.resolve(state.value) : Promise.reject(new Error("down")),
}));
vi.mock("../src/lib/bot-report", () => ({ botHitFor: () => null, reportBotHit: vi.fn() }));

const { proxy } = await import("../src/proxy");

const event = { waitUntil: vi.fn() } as never;

beforeEach(() => {
  state.value = {
    redirects: { "/blog/old": "/blog/new" },
    gone: ["/guides/removed", "/en/blog/removed"],
  };
});

describe("proxy content paths", () => {
  it("301s a renamed slug and drops the query string", async () => {
    const response = await proxy(new NextRequest("https://wasfa.online/blog/old?utm=x"), event);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://wasfa.online/blog/new");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("410s a removed page with noindex and a short cache", async () => {
    const response = await proxy(new NextRequest("https://wasfa.online/en/blog/removed"), event);
    expect(response.status).toBe(410);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('lang="en"');
  });

  it("leaves other content paths and non-content paths untouched", async () => {
    for (const path of ["/blog/fine", "/pricing", "/blog/feed.xml"]) {
      const response = await proxy(new NextRequest(`https://wasfa.online${path}`), event);
      expect(response.status).toBe(200);
    }
  });
});
