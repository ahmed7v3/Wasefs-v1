import { ogCardKey } from "@wasfa/shared/schemas/og";
import { describe, expect, it, vi } from "vitest";

import { ogRenderJob, renderAndStoreOgCard } from "../src/og/og.job.js";

import type { ObjectStore } from "../src/storage/object-store.js";

/** An in-memory stand-in for the public media bucket. */
function memoryStore(): {
  store: ObjectStore;
  objects: Map<string, Buffer>;
  put: ReturnType<typeof vi.fn>;
} {
  const objects = new Map<string, Buffer>();
  const put = vi.fn((key: string, body: Buffer) => {
    objects.set(key, body);
    return Promise.resolve();
  });
  const store = {
    get: (key: string) => Promise.resolve(objects.get(key) ?? null),
    put,
  } as unknown as ObjectStore;
  return { store, objects, put };
}

const payload = {
  template: "glossary",
  input: { locale: "ar", term: "BID", meaning: "مرتين يوميًا" },
} as const;

describe("og.render", () => {
  it("stores the card under og/<template>/<hash>.png and skips it the second time", async () => {
    const { store, objects, put } = memoryStore();
    const first = await renderAndStoreOgCard(store, payload);
    expect(first.created).toBe(true);
    expect(first.key).toMatch(/^og\/glossary\/[0-9a-f]{64}\.png$/);
    expect(objects.get(first.key)?.subarray(1, 4).toString()).toBe("PNG");
    expect(put).toHaveBeenCalledWith(
      first.key,
      expect.any(Buffer),
      "image/png",
      expect.stringContaining("immutable"),
    );

    const second = await renderAndStoreOgCard(store, payload);
    expect(second).toEqual({ key: first.key, created: false });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("writes another object when the input changes", async () => {
    const { store } = memoryStore();
    const a = await renderAndStoreOgCard(store, payload);
    const b = await renderAndStoreOgCard(store, {
      template: "glossary",
      input: { locale: "ar", term: "TID", meaning: "ثلاث مرات يوميًا" },
    });
    expect(b.key).not.toBe(a.key);
    expect(ogCardKey("glossary", "x")).toMatch(/^og\/glossary\//);
  });

  it("fails loudly when media storage is not configured", async () => {
    await expect(
      ogRenderJob(payload, { logger: { info: vi.fn() } as never, media: undefined }),
    ).rejects.toThrow(/Media storage is not configured/);
  });
});
