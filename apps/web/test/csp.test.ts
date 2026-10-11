import { describe, expect, it } from "vitest";

import { extractErrorRef } from "../src/lib/api-error";
import { SECURITY_HEADERS, buildCsp, generateNonce, parseSources } from "../src/lib/csp";

const base = {
  nonce: "abc123",
  isDev: false,
  apiOrigin: "https://api.wasfa.online",
  upgradeInsecure: true,
} as const;

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((part) => part.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("buildCsp", () => {
  it("allows scripts only from self, the nonce and strict-dynamic", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows unsafe-eval only in development", () => {
    expect(directive(buildCsp({ ...base, isDev: true }), "script-src")).toContain("'unsafe-eval'");
  });

  it("locks down framing, plugins, base and forms", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(directive(csp, "font-src")).toEqual(["'self'"]);
  });

  it("connects to self and the API origin only by default", () => {
    expect(directive(buildCsp(base), "connect-src")).toEqual([
      "'self'",
      "https://api.wasfa.online",
    ]);
  });

  it("lets images load from self, blobs, data URLs and the API (the uploaded logo), nowhere else", () => {
    expect(directive(buildCsp(base), "img-src")).toEqual([
      "'self'",
      "blob:",
      "data:",
      "https://api.wasfa.online",
    ]);
    expect(
      directive(buildCsp({ ...base, extra: { img: ["https://cdn.example.com"] } }), "img-src"),
    ).toContain("https://cdn.example.com");
  });

  it("adds env-driven extras (Turnstile, analytics) to the right directives", () => {
    const csp = buildCsp({
      ...base,
      extra: {
        script: ["https://challenges.cloudflare.com"],
        connect: ["https://www.google-analytics.com"],
        frame: ["https://challenges.cloudflare.com"],
      },
    });
    expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "connect-src")).toContain("https://www.google-analytics.com");
    expect(directive(csp, "frame-src")).toEqual(["https://challenges.cloudflare.com"]);
  });

  it("allows Cloudflare Turnstile only when a site key is configured", () => {
    const off = buildCsp(base);
    expect(off).not.toContain("challenges.cloudflare.com");
    expect(directive(off, "frame-src")).toEqual(["'none'"]);

    const on = buildCsp({ ...base, turnstile: true });
    expect(directive(on, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(on, "frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    // Nothing else widens: no inline scripts, no extra connect sources.
    expect(on).not.toContain("unsafe-inline");
    expect(directive(on, "connect-src")).toEqual(["'self'", "https://api.wasfa.online"]);
  });

  it("keeps env extras next to Turnstile in frame-src", () => {
    const csp = buildCsp({
      ...base,
      turnstile: true,
      extra: { frame: ["https://player.example"] },
    });
    expect(directive(csp, "frame-src")).toEqual([
      "https://challenges.cloudflare.com",
      "https://player.example",
    ]);
  });

  it("only upgrades insecure requests when asked", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, upgradeInsecure: false })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("parseSources", () => {
  it("accepts plain http(s) hosts, wildcards and ports, split by space or comma", () => {
    expect(
      parseSources(
        "https://challenges.cloudflare.com, https://*.example.com http://localhost:3000",
      ),
    ).toEqual([
      "https://challenges.cloudflare.com",
      "https://*.example.com",
      "http://localhost:3000",
    ]);
  });

  it("drops keywords, quotes, paths and directive injection attempts", () => {
    expect(
      parseSources("'unsafe-inline' * data: https://ok.example https://a.example/path;script-src"),
    ).toEqual(["https://ok.example"]);
    expect(parseSources(undefined)).toEqual([]);
    expect(parseSources("")).toEqual([]);
  });
});

describe("generateNonce", () => {
  it("is unique, base64 and CSP-safe", () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("SECURITY_HEADERS", () => {
  it("includes the headers required by the task", () => {
    expect(SECURITY_HEADERS).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("geolocation=()");
  });
});

describe("extractErrorRef", () => {
  it("returns a well-formed ref and ignores anything else", () => {
    expect(extractErrorRef({ ref: "WSF-7K2M-9QXD" })).toBe("WSF-7K2M-9QXD");
    expect(extractErrorRef({ ref: "<script>" })).toBeUndefined();
    expect(extractErrorRef(new Error("x"))).toBeUndefined();
    expect(extractErrorRef(null)).toBeUndefined();
  });
});
