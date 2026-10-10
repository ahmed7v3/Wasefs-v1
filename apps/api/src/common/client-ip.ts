import { isIP } from "node:net";

import proxyAddr from "proxy-addr";

import type { FastifyRequest } from "fastify";

export type TrustFn = (address: string, hop: number) => boolean;

export function compileTrust(proxies: readonly string[]): TrustFn {
  return proxies.length > 0 ? proxyAddr.compile([...proxies]) : () => false;
}

/**
 * Real client IP. `CF-Connecting-IP` is honoured only when the TCP peer is our own proxy
 * (Caddy); from anyone else it is attacker-controlled and ignored.
 */
export function clientIp(request: FastifyRequest, trust: TrustFn): string {
  const peer = request.socket.remoteAddress ?? request.ip;
  if (trust(peer, 0)) {
    const header = request.headers["cf-connecting-ip"];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && isIP(value.trim()) !== 0) {
      return value.trim();
    }
    return request.ip;
  }
  return peer;
}
