import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MEDIA_ORIGIN = "https://media.test/bucket/";
  process.env.API_INTERNAL_URL = "http://api.test";
});
vi.mock("server-only", () => ({}));

const api = await import("../src/lib/content-api");

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Call = [string, RequestInit & { next?: unknown }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("content-api", () => {
  it("fetches with tags and a revalidate window, parsing the response", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({ kind: "not_found" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.resolveContent("article", "ar", "x")).resolves.toEqual({ kind: "not_found" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("http://api.test/public/content/resolve?type=article&locale=ar&slug=x");
    expect(init.next).toEqual({
      revalidate: 3600,
      tags: ["content:list:article:ar", "content:taxonomy:ar", "content:path-state"],
    });
  });

  it("does not cache page-type resolves", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({ kind: "gone" })));
    vi.stubGlobal("fetch", fetchMock);
    await api.resolveContent("page", "ar", "about");
    expect((fetchMock.mock.calls[0] as unknown as Call)[1].cache).toBe("no-store");
  });

  it("throws on outages (network, 5xx, bad body) instead of answering not-found", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("boom")));
    await expect(api.resolveContent("article", "ar", "x")).rejects.toThrow(/unreachable/);
    vi.stubGlobal("fetch", () => Promise.resolve(json({}, 503)));
    await expect(
      api.listContent({ type: "article", locale: "ar", page: 1, pageSize: 1 }),
    ).rejects.toThrow();
    vi.stubGlobal("fetch", () => Promise.resolve(json({ nope: true })));
    await expect(api.getPublicPathState()).rejects.toThrow(/unexpected body/);
  });

  it("returns null for an explicit 404 on taxonomy pages and previews", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(json({}, 404)));
    await expect(api.getTaxonomyPage("tag", "ar", "x")).resolves.toBeNull();
    await expect(api.getPreview("tok")).resolves.toBeNull();
  });

  it("hasPublicContent maps totals and swallows errors", async () => {
    vi.stubGlobal("fetch", (input: string) =>
      Promise.resolve(
        json({ items: [], total: input.includes("type=guide") ? 3 : 0, page: 1, pageSize: 1 }),
      ),
    );
    await expect(api.hasPublicContent("ar")).resolves.toEqual({
      blog: false,
      guides: true,
      glossary: false,
    });
    vi.stubGlobal("fetch", () => Promise.reject(new Error("down")));
    await expect(api.hasPublicContent("ar")).resolves.toEqual({
      blog: false,
      guides: false,
      glossary: false,
    });
  });

  it("mediaUrl joins origin and key", () => {
    expect(api.mediaUrl("media/a/1.webp")).toBe("https://media.test/bucket/media/a/1.webp");
  });
});
