import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { AppError, ErrorCode } from "@wasfa/shared/errors";

import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";

/*
 * SSRF guard for `POST /media/fetch` (and, later, webhook URLs). The server fetches an address an
 * outside party chose, so every step is checked: https only on port 443, no credentials, the name is
 * resolved HERE and every resolved address must be public (private, loopback, link-local, CGNAT,
 * metadata, multicast, documentation and reserved ranges, IPv4 and IPv6, IPv4-mapped IPv6 included),
 * the connection is then PINNED to the checked address (the TLS name and Host header stay the original,
 * so there is no second DNS lookup an attacker could answer differently), each redirect hop (max 3) is
 * checked again, the whole fetch has a 10 s deadline and the body is streamed under a hard byte cap.
 * Errors never echo the URL or the underlying cause.
 */

export const FETCH_MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 10_000;
const URL_MAX = 2_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ---------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------

/** `a.b.c.d` -> 32-bit number, or null when it is not a plain dotted quad. */
function ipv4ToInt(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** [network, prefix length] pairs that are not public IPv4. */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes the broadcast address
];

export function isForbiddenIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true; // not an address we understand: refuse
  return BLOCKED_V4.some(([network, bits]) => {
    const base = ipv4ToInt(network) ?? 0;
    const size = 2 ** (32 - bits);
    return value >= base && value < base + size;
  });
}

/** Eight 16-bit groups of an IPv6 address (zone ids dropped, an embedded IPv4 tail expanded), or null. */
export function parseIpv6(address: string): number[] | null {
  const bare = address.split("%")[0] ?? "";
  if (isIP(bare) !== 6) return null;
  let text = bare;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail?.[1] !== undefined) {
    const v4 = ipv4ToInt(tail[1]);
    if (v4 === null) return null;
    text = `${text.slice(0, -tail[1].length)}${Math.floor(v4 / 65_536).toString(16)}:${(v4 % 65_536).toString(16)}`;
  }
  const [head = "", rest, extra] = text.split("::");
  if (extra !== undefined) return null;
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const missing = 8 - left.length - right.length;
  if ((rest === undefined && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array<string>(rest === undefined ? 0 : missing).fill("0"), ...right];
  const numbers = groups.map((group) => Number.parseInt(group, 16));
  return numbers.length === 8 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? numbers
    : null;
}

const v4From = (high: number, low: number): string =>
  `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;

export function isForbiddenIpv6(address: string): boolean {
  const g = parseIpv6(address);
  if (g === null) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  // ::ffff:a.b.c.d (IPv4-mapped): the IPv4 rules decide.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isForbiddenIpv4(v4From(g6, g7));
  }
  // 64:ff9b::/96 (NAT64): the embedded IPv4 decides.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isForbiddenIpv4(v4From(g6, g7));
  }
  // Only global unicast 2000::/3 can be public; everything else (::, ::1, fc00::/7, fe80::/10,
  // fec0::/10, ff00::/8, 100::/64 ...) is not.
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2002) return true; // 6to4: embeds an arbitrary IPv4
  return false;
}

/** True for any address a server-side fetch must refuse. */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address.split("%")[0] ?? "");
  if (family === 4) return isForbiddenIpv4(address);
  if (family === 6) return isForbiddenIpv6(address);
  return true;
}

// ---------------------------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportRequest {
  url: URL;
  /** The checked address to connect to; the name in `url` is only for TLS (SNI) and the Host header. */
  address: ResolvedAddress;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Readable | AsyncIterable<Uint8Array>;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface FetchOptions {
  maxBytes: number;
  maxRedirects?: number;
  timeoutMs?: number;
  resolve?: Resolver;
  transport?: Transport;
}

export interface FetchedBody {
  bytes: Buffer;
  contentType: string | null;
}

/** Reasons are a closed set, safe to return: they say what failed, never where. */
export type FetchRefusal =
  | "bad_url"
  | "blocked_address"
  | "unresolvable"
  | "too_many_redirects"
  | "remote_error"
  | "timeout";

function refuse(reason: FetchRefusal): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, {
    details: { fields: ["source_url"], reason },
  });
}

const defaultResolver: Resolver = async (hostname) => {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family === 6 ? 6 : 4 }));
};

/** Validates an admin-supplied webhook URL with the same DNS/private-range policy as media fetch. */
export async function validateWebhookUrl(rawUrl: string): Promise<void> {
  await checkTarget(rawUrl, defaultResolver);
}

const defaultTransport: Transport = ({ url, address, signal }) =>
  new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // The lookup hook is the pin: the socket connects to the address we checked, whatever DNS says now.
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if ((options as { all?: boolean }).all === true) {
        (callback as unknown as (error: null, all: ResolvedAddress[]) => void)(null, [address]);
      } else {
        callback(null, address.address, address.family);
      }
    };
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        lookup: pinned,
        signal,
        ...(isIP(host) === 0 ? { servername: host } : {}),
        headers: {
          host: url.host,
          accept: "image/*",
          // No compression: a gzip bomb would sidestep the byte cap's meaning.
          "accept-encoding": "identity",
          "user-agent": "WasfaMediaFetcher/1.0 (+https://wasfa.online)",
        },
      },
      (response) => {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
      },
    );
    request.on("error", reject);
    request.end();
  });

/** Parses and screens one URL; returns it with the address to connect to. */
export async function checkTarget(
  raw: string,
  resolve: Resolver,
): Promise<{ url: URL; address: ResolvedAddress }> {
  if (raw.length > URL_MAX) throw refuse("bad_url");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refuse("bad_url");
  }
  if (url.protocol !== "https:") throw refuse("bad_url");
  if (url.username !== "" || url.password !== "") throw refuse("bad_url");
  if (url.port !== "" && url.port !== "443") throw refuse("bad_url");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  if (literal !== 0) {
    if (isForbiddenAddress(host)) throw refuse("blocked_address");
    return { url, address: { address: host, family: literal === 6 ? 6 : 4 } };
  }
  const lower = host.toLowerCase();
  if (!lower.includes(".") || lower.endsWith(".local") || lower.endsWith(".internal")) {
    throw refuse("blocked_address");
  }
  let resolved: ResolvedAddress[];
  try {
    resolved = await resolve(host);
  } catch {
    throw refuse("unresolvable");
  }
  const first = resolved[0];
  if (first === undefined) throw refuse("unresolvable");
  // One private answer among public ones is enough to refuse: the attacker controls the zone.
  if (resolved.some((row) => isForbiddenAddress(row.address))) throw refuse("blocked_address");
  return { url, address: first };
}

async function readCapped(
  body: TransportResponse["body"],
  maxBytes: number,
  declared: number | null,
): Promise<Buffer> {
  if (declared !== null && declared > maxBytes) {
    destroy(body);
    throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const piece = Buffer.from(chunk);
    total += piece.length;
    if (total > maxBytes) {
      destroy(body);
      throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks, total);
}

function destroy(body: TransportResponse["body"]): void {
  (body as { destroy?: () => void }).destroy?.();
}

/**
 * Fetches `rawUrl` under every rule above. Throws `VALIDATION_FAILED` (`details.reason` one of
 * `FetchRefusal`), `PAYLOAD_TOO_LARGE`, never a message carrying the URL or a system error.
 */
export async function fetchPublicBytes(
  rawUrl: string,
  options: FetchOptions,
): Promise<FetchedBody> {
  const resolve = options.resolve ?? defaultResolver;
  const transport = options.transport ?? defaultTransport;
  const maxRedirects = options.maxRedirects ?? FETCH_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      // Every hop is screened again: a redirect is just another untrusted address.
      const target = await checkTarget(current, resolve);
      const response = await transport({
        url: target.url,
        address: target.address,
        signal: controller.signal,
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        destroy(response.body);
        const location = response.headers.location;
        if (typeof location !== "string" || location === "") throw refuse("remote_error");
        if (hop === maxRedirects) throw refuse("too_many_redirects");
        try {
          current = new URL(location, target.url).toString();
        } catch {
          throw refuse("bad_url");
        }
        continue;
      }
      if (response.status !== 200) {
        destroy(response.body);
        throw refuse("remote_error");
      }
      const length = Number(response.headers["content-length"]);
      const type = response.headers["content-type"];
      const bytes = await readCapped(
        response.body,
        options.maxBytes,
        Number.isFinite(length) && length >= 0 ? length : null,
      );
      return { bytes, contentType: typeof type === "string" ? type : null };
    }
    throw refuse("too_many_redirects");
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) throw refuse("timeout");
    throw refuse("remote_error");
  } finally {
    clearTimeout(timer);
  }
}
