import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { GET, HEAD } = await import("../src/app/t/[token]/route");

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("https://wasfa.test/t/tok", { headers }), {
    params: Promise.resolve({ token: "tok" }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/t/[token]", () => {
  it("answers 302 to the button URL the API returns", async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: "https://shop.example/offer" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await call({ "x-forwarded-for": "1.2.3.4" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://shop.example/offer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lands on the home page for a bad token or an API failure, never an error screen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404 })));
    const bad = await call();
    expect(bad.status).toBe(302);
    expect(new URL(bad.headers.get("location") ?? "").pathname).toBe("/");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect((await call()).status).toBe(302);
  });

  it("never follows a non-https destination", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "javascript:alert(1)" })));
    const response = await call();
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("counts nothing for a prefetch or a HEAD request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call({ "sec-purpose": "prefetch" })).status).toBe(204);
    expect(HEAD().status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
