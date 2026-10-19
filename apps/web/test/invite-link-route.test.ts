import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "../src/app/r/[code]/route";
import { normalizeJoinSlug, normalizeReferralCode } from "../src/lib/attribution-cookies";

const call = (code: string) =>
  GET(new NextRequest(`https://wasfa.test/r/${code}`), { params: Promise.resolve({ code }) });

describe("/r/[code]", () => {
  it("remembers a well-formed code for 30 days and sends the visitor to register with it", async () => {
    const response = await call("ab12cd");
    expect(response.status).toBe(302);
    // Relative, so the browser keeps the public host (the server behind the proxy only knows 0.0.0.0).
    expect(response.headers.get("location")).toBe("/register?ref=AB12CD");
    const cookie = response.cookies.get("wasfa_ref");
    expect(cookie?.value).toBe("AB12CD");
    expect(cookie?.maxAge).toBe(30 * 86_400);
    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sets no cookie for a code of the wrong shape", async () => {
    for (const bad of ["a", "ab", "has-dash", "x".repeat(21), "%3Cscript%3E"]) {
      const response = await call(bad);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/register");
      expect(response.cookies.get("wasfa_ref")).toBeUndefined();
    }
  });
});

describe("attribution codes", () => {
  it("upper-cases invite codes and lower-cases join slugs, rejecting other shapes", () => {
    expect(normalizeReferralCode(" abc123 ")).toBe("ABC123");
    expect(normalizeReferralCode("a b")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
    expect(normalizeJoinSlug("Al-Nour")).toBe("al-nour");
    expect(normalizeJoinSlug("-bad")).toBeNull();
    expect(normalizeJoinSlug("ab")).toBeNull();
  });
});
