import { REVALIDATE_HEADER, verifyRevalidation } from "@wasfa/shared/content/revalidate";
import { revalidateRequestSchema } from "@wasfa/shared/schemas/content";
import { describe, expect, it, vi } from "vitest";

import { chunkTags, revalidateTags } from "../src/content/revalidate-client.js";

const secret = "s".repeat(40);
const logger = { info: vi.fn(), warn: vi.fn() };
const NOW = 1_800_000_000;

const call = (fetchImpl: unknown, tags: string[] = ["a:b"]) =>
  revalidateTags({
    webInternalUrl: "http://web:3000",
    secret,
    tags,
    logger,
    fetchImpl: fetchImpl as typeof fetch,
    nowSeconds: () => NOW,
  });

describe("revalidateTags", () => {
  it("posts a body whose signature the web verifies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(call(fetchImpl, ["content:path-state"])).resolves.toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string>; signal: AbortSignal; method: string },
    ];
    expect(url).toBe("http://web:3000/api/revalidate");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = revalidateRequestSchema.parse(JSON.parse(init.body));
    expect(body).toEqual({ tags: ["content:path-state"], timestamp: NOW });
    expect(
      verifyRevalidation({
        secret,
        signature: init.headers[REVALIDATE_HEADER] ?? "",
        timestamp: body.timestamp,
        body: init.body,
        now: NOW,
        windowSeconds: 300,
      }),
    ).toEqual({ ok: true });
  });

  it("chunks at 50 tags per request", async () => {
    const tags = Array.from({ length: 120 }, (_, i) => `t:${String(i)}`);
    expect(chunkTags(tags).map((c) => c.length)).toEqual([50, 50, 20]);
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response(null)));
    await call(fetchImpl, tags);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("skips when either setting is unset", async () => {
    const fetchImpl = vi.fn();
    const args = { tags: ["a"], logger, fetchImpl: fetchImpl as unknown as typeof fetch };
    await expect(revalidateTags({ ...args, webInternalUrl: undefined, secret })).resolves.toBe(
      "skipped",
    );
    await expect(
      revalidateTags({ ...args, webInternalUrl: "http://web:3000", secret: undefined }),
    ).resolves.toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("tolerates 404 and throws on other failures", async () => {
    await expect(
      call(vi.fn().mockResolvedValue(new Response(null, { status: 404 }))),
    ).resolves.toBe("sent");
    await expect(
      call(vi.fn().mockResolvedValue(new Response(null, { status: 500 }))),
    ).rejects.toThrow("500");
    await expect(call(vi.fn().mockRejectedValue(new Error("ECONNRESET")))).rejects.toThrow();
  });

  it("propagates a timeout", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(call(fetchImpl)).rejects.toThrow("timed out");
  });
});
