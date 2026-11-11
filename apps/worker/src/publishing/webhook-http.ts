import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export interface WebhookResponse {
  status: number;
}

const URL_MAX = 2_000;
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
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

function forbiddenIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return BLOCKED_V4.some(([network, bits]) => {
    const base = ipv4ToInt(network) ?? 0;
    return value >= base && value < base + 2 ** (32 - bits);
  });
}

function parseIpv6(address: string): number[] | null {
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
  return numbers.length === 8 && numbers.every((item) => Number.isInteger(item) && item >= 0 && item <= 0xffff)
    ? numbers
    : null;
}

function forbiddenIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (groups === null) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const embedded = `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return forbiddenIpv4(embedded);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return forbiddenIpv4(embedded);
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x2001 && g1 === 0) return true;
  if (g0 === 0x2002) return true;
  return false;
}

function forbiddenAddress(address: string): boolean {
  const family = isIP(address.split("%")[0] ?? "");
  return family === 4 ? forbiddenIpv4(address) : family === 6 ? forbiddenIpv6(address) : true;
}

/** POSTs to a public HTTPS endpoint while pinning the DNS answer checked for SSRF. */
export async function postWebhook(rawUrl: string, body: string, headers: Record<string, string>): Promise<WebhookResponse> {
  if (rawUrl.length > URL_MAX) throw new Error("blocked_url");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("blocked_url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  if (literal === 0 && (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal"))) {
    throw new Error("blocked_address");
  }
  const rows = literal === 0 ? await lookup(host, { all: true, verbatim: true }) : [{ address: host, family: literal }];
  if (rows.length === 0 || rows.some((row) => forbiddenAddress(row.address))) throw new Error("blocked_address");
  const address = rows[0];
  if (!address) throw new Error("unresolvable");
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const req = request(
      {
        protocol: "https:",
        hostname: host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        signal: controller.signal,
        lookup: (_host, options, callback) => {
          if ((options as { all?: boolean }).all) {
            (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, [
              { address: address.address, family: address.family },
            ]);
          } else callback(null, address.address, address.family);
        },
        ...(literal === 0 ? { servername: host } : {}),
        headers: {
          host: url.host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "WasfaWebhook/1.0",
          ...headers,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          clearTimeout(timer);
          resolve({ status: response.statusCode ?? 0 });
        });
      },
    );
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.end(body);
  });
}
