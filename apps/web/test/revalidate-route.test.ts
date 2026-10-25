import { REVALIDATE_HEADER, signRevalidation } from "@wasfa/shared/content/revalidate";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(40);
const env = vi.hoisted(() => ({ secret: undefined as string | undefined }));
const revalidateTag = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag }));
vi.mock("../src/lib/server-env", () => ({
  serverEnv: {
    API_INTERNAL_URL: "http://api.test",
    get REVALIDATE_SECRET() {
      return env.secret;
    },
  },
}));

type Route = typeof import("../src/app/api/revalidate/route");
let POST: Route["POST"];

beforeEach(async () => {
  vi.resetModules();
  revalidateTag.mockClear();
  env.secret = SECRET;
  ({ POST } = await import("../src/app/api/revalidate/route"));
});

const now = (): number => Math.floor(Date.now() / 1000);

function signed(payload: unknown, timestamp = now(), secret = SECRET): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Request("http://web.test/api/revalidate", {
    method: "POST",
    body,
    headers: { [REVALIDATE_HEADER]: signRevalidation(secret, timestamp, body) },
  });
}

describe("POST /api/revalidate", () => {
  it("revalidates each tag with the max profile", async () => {
    const response = await POST(
      signed({ tags: ["content:list:article:ar", "sitemap:article"], timestamp: now() }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: 2 });
    expect(revalidateTag).toHaveBeenCalledWith("content:list:article:ar", "max");
    expect(revalidateTag).toHaveBeenCalledWith("sitemap:article", "max");
  });

  it("404 when the secret is unset", async () => {
    env.secret = undefined;
    expect((await POST(signed({ tags: ["a"], timestamp: now() }))).status).toBe(404);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("401 for a tampered body, a wrong secret, a missing header and a stale timestamp", async () => {
    const good = JSON.stringify({ tags: ["a"], timestamp: now() });
    const tampered = new Request("http://web.test/api/revalidate", {
      method: "POST",
      body: good.replace('"a"', '"b"'),
      headers: { [REVALIDATE_HEADER]: signRevalidation(SECRET, now(), good) },
    });
    expect((await POST(tampered)).status).toBe(401);
    expect(
      (await POST(signed({ tags: ["a"], timestamp: now() }, now(), "x".repeat(40)))).status,
    ).toBe(401);
    const bare = new Request("http://web.test/api/revalidate", { method: "POST", body: good });
    expect((await POST(bare)).status).toBe(401);
    const old = now() - 1000;
    expect((await POST(signed({ tags: ["a"], timestamp: old }, old))).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("409 for a replayed signature", async () => {
    const payload = { tags: ["a"], timestamp: now() };
    const first = signed(payload);
    const replay = new Request(first.url, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { [REVALIDATE_HEADER]: first.headers.get(REVALIDATE_HEADER) ?? "" },
    });
    expect((await POST(first)).status).toBe(200);
    expect((await POST(replay)).status).toBe(409);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it("400 for a signed but invalid body and for more than 50 tags", async () => {
    expect((await POST(signed({ tags: [], timestamp: now() }))).status).toBe(400);
    expect((await POST(signed({ tags: ["Bad Tag!"], timestamp: now() }))).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `t:${String(i)}`);
    expect((await POST(signed({ tags: many, timestamp: now() }))).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("401 (not a crash) for a body that is not JSON", async () => {
    expect((await POST(signed("not json"))).status).toBe(401);
  });

  it("429 after 120 requests in a minute", async () => {
    for (let i = 0; i < 120; i += 1)
      await POST(signed({ tags: [`t:${String(i)}`], timestamp: now() }));
    expect((await POST(signed({ tags: ["late"], timestamp: now() }))).status).toBe(429);
  });
});
