import { describe, expect, it, vi } from "vitest";

import { contentChangeHandler, indexNowUrls } from "../src/content/change-handler.js";

import type { OutboxEntry } from "@wasfa/db";

const ID = "11111111-1111-4111-8111-111111111111";
const payload = (over: Record<string, unknown> = {}) => ({
  itemId: ID,
  kind: "published",
  paths: ["/ar/articles/x"],
  oldPaths: [],
  ...over,
});
const parse = (over: Record<string, unknown>) => payload(over) as never;

describe("indexNowUrls", () => {
  it("builds absolute urls from paths and oldPaths, deduplicated", () => {
    expect(
      indexNowUrls(
        parse({ kind: "moved", paths: ["/ar/a", "/ar/a"], oldPaths: ["/ar/old"] }),
        { noindex: false },
        "https://wasfa.online",
      ),
    ).toEqual(["https://wasfa.online/ar/a", "https://wasfa.online/ar/old"]);
  });

  it("covers unpublished and archived, ignores taxonomy and redirects", () => {
    const origin = "https://wasfa.online";
    expect(
      indexNowUrls(parse({ kind: "unpublished", paths: [], oldPaths: ["/ar/a"] }), null, origin),
    ).toHaveLength(1);
    expect(indexNowUrls(parse({ kind: "archived" }), null, origin)).toHaveLength(1);
    expect(indexNowUrls(parse({ kind: "taxonomy" }), null, origin)).toEqual([]);
    expect(indexNowUrls(parse({ kind: "redirects" }), null, origin)).toEqual([]);
  });

  it("skips noindex items and non-https origins", () => {
    expect(indexNowUrls(parse({}), { noindex: true }, "https://wasfa.online")).toEqual([]);
    expect(indexNowUrls(parse({}), { noindex: false }, "http://localhost:3000")).toEqual([]);
  });
});

describe("contentChangeHandler", () => {
  const entry = (data: unknown) => ({ payload: data }) as unknown as OutboxEntry;
  function setup(indexNow = { enabled: true, key: "k".repeat(16) as string | null }, status = 200) {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status }));
    const enqueueIndexNow = vi.fn().mockResolvedValue(undefined);
    const handler = contentChangeHandler({
      logger: { info: vi.fn(), warn: vi.fn() },
      webInternalUrl: "http://web:3000",
      revalidateSecret: "s".repeat(40),
      webOrigin: "https://wasfa.online",
      indexNowSettings: () => Promise.resolve(indexNow),
      enqueueIndexNow,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupItem: () => Promise.resolve({ type: "article", locale: "ar", noindex: false }),
    });
    return { handler, fetchImpl, enqueueIndexNow };
  }

  it("purges the cache and queues IndexNow urls", async () => {
    const { handler, fetchImpl, enqueueIndexNow } = setup();
    await handler({} as never, entry(payload()));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(enqueueIndexNow).toHaveBeenCalledWith(["https://wasfa.online/ar/articles/x"]);
  });

  it("does not queue IndexNow while it is disabled or has no key", async () => {
    for (const settings of [
      { enabled: false, key: "k".repeat(16) },
      { enabled: true, key: null },
    ]) {
      const { handler, enqueueIndexNow } = setup(settings);
      await handler({} as never, entry(payload()));
      expect(enqueueIndexNow).not.toHaveBeenCalled();
    }
  });

  it("throws when the web answers 500 so the outbox retries, and queues nothing", async () => {
    const { handler, enqueueIndexNow } = setup(undefined, 500);
    await expect(handler({} as never, entry(payload()))).rejects.toThrow("500");
    expect(enqueueIndexNow).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload", async () => {
    const { handler } = setup();
    await expect(handler({} as never, entry({ kind: "nope" }))).rejects.toThrow();
  });
});
