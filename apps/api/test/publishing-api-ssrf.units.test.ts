import { Readable } from "node:stream";

import { ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it, vi } from "vitest";

import {
  checkTarget,
  fetchPublicBytes,
  isForbiddenAddress,
  parseIpv6,
  type Resolver,
  type Transport,
  type TransportRequest,
} from "../src/publishing/publishing-api-ssrf.js";

const PUBLIC_V4 = "93.184.216.34";
const resolvesTo =
  (...addresses: string[]): Resolver =>
  () =>
    Promise.resolve(
      addresses.map((address) => ({
        address,
        family: address.includes(":") ? (6 as const) : (4 as const),
      })),
    );

const body = (text: string | Buffer): Readable => Readable.from([Buffer.from(text)]);
const ok = (data: string | Buffer, headers: Record<string, string> = {}) => ({
  status: 200,
  headers: { "content-type": "image/jpeg", ...headers },
  body: body(data),
});
const redirect = (location: string, status = 302) => ({
  status,
  headers: { location },
  body: body(""),
});

const refusal = (reason: string) =>
  expect.objectContaining({
    code: ErrorCode.VALIDATION_FAILED,
    details: { fields: ["source_url"], reason },
  });

describe("isForbiddenAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1", // carrier-grade NAT
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254", // cloud metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1", // multicast
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254", // IPv6 metadata
    "ff02::1",
    "fec0::1",
    "2001:db8::1",
    "2002:7f00:1::1", // 6to4 embedding 127.0.0.1
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:c0a8:101",
    "64:ff9b::7f00:1", // NAT64 embedding loopback
    "::127.0.0.1",
    "not-an-ip",
    "",
  ])("refuses %s", (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "198.17.255.255",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81e::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows the public address %s", (address) => {
    expect(isForbiddenAddress(address)).toBe(false);
  });
});

describe("parseIpv6", () => {
  it("expands shorthand and embedded IPv4", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIpv6("2001:db8:0:0:0:0:0:1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("1.2.3.4")).toBeNull();
  });
});

describe("checkTarget", () => {
  it.each([
    ["http://example.org/a.jpg", "bad_url"],
    ["ftp://example.org/a.jpg", "bad_url"],
    ["file:///etc/passwd", "bad_url"],
    ["https://user:pw@example.org/a.jpg", "bad_url"],
    ["https://example.org:8443/a.jpg", "bad_url"],
    ["not a url", "bad_url"],
    [`https://example.org/${"a".repeat(2100)}`, "bad_url"],
    ["https://localhost/a.jpg", "blocked_address"],
    ["https://intranet/a.jpg", "blocked_address"],
    ["https://printer.local/a.jpg", "blocked_address"],
    ["https://db.internal/a.jpg", "blocked_address"],
    ["https://127.0.0.1/a.jpg", "blocked_address"],
    ["https://0x7f.1/a.jpg", "blocked_address"], // normalised to 127.0.0.1 by the URL parser
    ["https://2130706433/a.jpg", "blocked_address"], // decimal form of 127.0.0.1
    ["https://169.254.169.254/latest/meta-data", "blocked_address"],
    ["https://[::1]/a.jpg", "blocked_address"],
    ["https://[::ffff:127.0.0.1]/a.jpg", "blocked_address"],
    ["https://[fd00:ec2::254]/a.jpg", "blocked_address"],
  ])("refuses %s as %s", async (url, reason) => {
    await expect(checkTarget(url, resolvesTo(PUBLIC_V4))).rejects.toEqual(refusal(reason));
  });

  it("refuses a name that resolves to a private address", async () => {
    await expect(
      checkTarget("https://cdn.example.org/a.jpg", resolvesTo("10.0.0.5")),
    ).rejects.toEqual(refusal("blocked_address"));
    await expect(
      checkTarget("https://cdn.example.org/a.jpg", resolvesTo("::ffff:10.0.0.5")),
    ).rejects.toEqual(refusal("blocked_address"));
  });

  it("refuses when ANY answer is private (a zone the attacker controls can mix them)", async () => {
    await expect(
      checkTarget("https://cdn.example.org/a.jpg", resolvesTo(PUBLIC_V4, "169.254.169.254")),
    ).rejects.toEqual(refusal("blocked_address"));
  });

  it("refuses an unresolvable name and an empty answer", async () => {
    await expect(
      checkTarget("https://cdn.example.org/a.jpg", () => Promise.reject(new Error("ENOTFOUND"))),
    ).rejects.toEqual(refusal("unresolvable"));
    await expect(checkTarget("https://cdn.example.org/a.jpg", resolvesTo())).rejects.toEqual(
      refusal("unresolvable"),
    );
  });

  it("accepts a public https URL and returns the address to pin", async () => {
    const target = await checkTarget("https://cdn.example.org/a.jpg", resolvesTo(PUBLIC_V4));
    expect(target.address).toEqual({ address: PUBLIC_V4, family: 4 });
    expect(target.url.hostname).toBe("cdn.example.org");
  });

  it("accepts a public IPv6 literal", async () => {
    const target = await checkTarget("https://[2606:4700:4700::1111]/a.jpg", resolvesTo());
    expect(target.address.family).toBe(6);
  });
});

describe("fetchPublicBytes", () => {
  it("returns the bytes and content type", async () => {
    const transport: Transport = vi.fn(() => Promise.resolve(ok("IMG")));
    const fetched = await fetchPublicBytes("https://cdn.example.org/a.jpg", {
      maxBytes: 100,
      resolve: resolvesTo(PUBLIC_V4),
      transport,
    });
    expect(fetched.bytes.toString()).toBe("IMG");
    expect(fetched.contentType).toBe("image/jpeg");
  });

  it("connects to the address it checked, with the original name for TLS and Host (no second lookup)", async () => {
    const resolve = vi.fn(resolvesTo(PUBLIC_V4));
    const transport = vi.fn((request: TransportRequest) => {
      void request;
      return Promise.resolve(ok("IMG"));
    });
    await fetchPublicBytes("https://cdn.example.org/a.jpg?x=1", {
      maxBytes: 100,
      resolve,
      transport,
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0]?.[0];
    expect(request?.address).toEqual({ address: PUBLIC_V4, family: 4 });
    expect(request?.url.hostname).toBe("cdn.example.org");
  });

  it("is not fooled by DNS rebinding: a later answer is never used for the connection", async () => {
    let calls = 0;
    // First answer public (checked), any later answer private: a rebinding attacker's second lookup.
    const resolve: Resolver = () => {
      calls += 1;
      return resolvesTo(calls === 1 ? PUBLIC_V4 : "127.0.0.1")("x");
    };
    const connected: string[] = [];
    const transport: Transport = (request) => {
      connected.push(request.address.address);
      return Promise.resolve(ok("IMG"));
    };
    await fetchPublicBytes("https://rebind.example.org/a.jpg", {
      maxBytes: 100,
      resolve,
      transport,
    });
    expect(connected).toEqual([PUBLIC_V4]);
    expect(calls).toBe(1);
  });

  it("re-checks every redirect hop: a redirect to a private address is refused", async () => {
    const transport: Transport = vi.fn(() =>
      Promise.resolve(redirect("https://169.254.169.254/latest/meta-data")),
    );
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", {
        maxBytes: 100,
        resolve: resolvesTo(PUBLIC_V4),
        transport,
      }),
    ).rejects.toEqual(refusal("blocked_address"));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("re-resolves the redirect target and refuses one whose name resolves privately", async () => {
    const resolve: Resolver = (hostname) =>
      resolvesTo(hostname === "evil.example.org" ? "10.0.0.9" : PUBLIC_V4)("x");
    const transport: Transport = vi.fn(() =>
      Promise.resolve(redirect("https://evil.example.org/x")),
    );
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", { maxBytes: 100, resolve, transport }),
    ).rejects.toEqual(refusal("blocked_address"));
  });

  it("refuses a downgrade to http on a redirect", async () => {
    const transport: Transport = vi.fn(() =>
      Promise.resolve(redirect("http://cdn.example.org/a.jpg")),
    );
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", {
        maxBytes: 100,
        resolve: resolvesTo(PUBLIC_V4),
        transport,
      }),
    ).rejects.toEqual(refusal("bad_url"));
  });

  it("follows up to 3 redirects, including relative ones, then stops", async () => {
    const hops = ["/b", "/c", "/d"];
    let index = 0;
    const urls: string[] = [];
    const transport: Transport = (request) => {
      urls.push(request.url.pathname);
      const next = hops[index];
      index += 1;
      return Promise.resolve(next === undefined ? ok("IMG") : redirect(next, 301));
    };
    const fetched = await fetchPublicBytes("https://cdn.example.org/a", {
      maxBytes: 100,
      resolve: resolvesTo(PUBLIC_V4),
      transport,
    });
    expect(fetched.bytes.toString()).toBe("IMG");
    expect(urls).toEqual(["/a", "/b", "/c", "/d"]);

    const endless: Transport = () => Promise.resolve(redirect("/again"));
    await expect(
      fetchPublicBytes("https://cdn.example.org/a", {
        maxBytes: 100,
        resolve: resolvesTo(PUBLIC_V4),
        transport: endless,
      }),
    ).rejects.toEqual(refusal("too_many_redirects"));
  });

  it("stops at the byte cap while streaming (413), without buffering the rest", async () => {
    let produced = 0;
    async function* endless() {
      for (;;) {
        produced += 1;
        yield Buffer.alloc(1_000);
        await Promise.resolve();
      }
    }
    const transport: Transport = () =>
      Promise.resolve({ status: 200, headers: {}, body: Readable.from(endless()) });
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", {
        maxBytes: 5_000,
        resolve: resolvesTo(PUBLIC_V4),
        transport,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PAYLOAD_TOO_LARGE });
    expect(produced).toBeLessThan(50);
  });

  it("refuses up front when Content-Length already exceeds the cap", async () => {
    const transport: Transport = () => Promise.resolve(ok("x", { "content-length": "999999" }));
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", {
        maxBytes: 100,
        resolve: resolvesTo(PUBLIC_V4),
        transport,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PAYLOAD_TOO_LARGE });
  });

  it("times out", async () => {
    const transport: Transport = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", {
        maxBytes: 100,
        timeoutMs: 20,
        resolve: resolvesTo(PUBLIC_V4),
        transport,
      }),
    ).rejects.toEqual(refusal("timeout"));
  });

  it("a non-200 answer is a generic remote_error", async () => {
    const transport: Transport = () =>
      Promise.resolve({ status: 404, headers: {}, body: body("nope") });
    await expect(
      fetchPublicBytes("https://cdn.example.org/a.jpg", {
        maxBytes: 100,
        resolve: resolvesTo(PUBLIC_V4),
        transport,
      }),
    ).rejects.toEqual(refusal("remote_error"));
  });

  it("never echoes the URL or the underlying error in what it throws", async () => {
    const secret = "https://cdn.example.org/private/token-abc123.jpg";
    const transport: Transport = () => Promise.reject(new Error(`connect ECONNREFUSED ${secret}`));
    const error = await fetchPublicBytes(secret, {
      maxBytes: 100,
      resolve: resolvesTo(PUBLIC_V4),
      transport,
    }).catch((caught: unknown) => caught);
    expect(JSON.stringify(error)).not.toContain("token-abc123");
    expect(String((error as Error).message)).not.toContain("token-abc123");
    expect(JSON.stringify((error as { details?: unknown }).details)).not.toContain("example.org");
  });
});
