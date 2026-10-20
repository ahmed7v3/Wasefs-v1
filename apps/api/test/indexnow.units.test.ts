import { describe, expect, it, vi } from "vitest";

import { enqueueIndexNow } from "../src/seo/indexnow.js";

describe("enqueueIndexNow", () => {
  it("dedupes and splits into jobs of at most 100 URLs", async () => {
    const add = vi.fn();
    const urls = Array.from({ length: 150 }, (_, i) => `https://wasfa.online/ar/${String(i)}`);
    await enqueueIndexNow({ add } as never, [...urls, urls[0] as string]);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0]?.[0]).toBe("seo.indexnow");
    expect((add.mock.calls[0]?.[1] as { urls: string[] }).urls).toHaveLength(100);
    expect((add.mock.calls[1]?.[1] as { urls: string[] }).urls).toHaveLength(50);
  });

  it("queues nothing for an empty list and rejects non-https URLs", async () => {
    const add = vi.fn();
    await enqueueIndexNow({ add } as never, []);
    expect(add).not.toHaveBeenCalled();
    await expect(enqueueIndexNow({ add } as never, ["http://wasfa.online/"])).rejects.toThrow();
  });
});
