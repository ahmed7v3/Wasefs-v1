import { beforeEach, describe, expect, it, vi } from "vitest";

const headerValue = vi.hoisted(() => ({ current: null as string | null }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: () => headerValue.current }),
}));

const { adCountry } = await import("../src/lib/ad-country");

describe("adCountry", () => {
  beforeEach(() => {
    headerValue.current = null;
  });

  it("returns the uppercased two-letter code", async () => {
    headerValue.current = "eg";
    expect(await adCountry()).toBe("EG");
  });

  it("is undefined without the header", async () => {
    expect(await adCountry()).toBeUndefined();
  });

  it.each(["XX", "T1", "EGY", "1A", ""])("rejects %j", async (value) => {
    headerValue.current = value;
    expect(await adCountry()).toBeUndefined();
  });
});
