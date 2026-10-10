import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { clientIp, type TrustFn } from "./client-ip.js";
import { requestLocale } from "./errors.js";

import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

const WINDOW_SECONDS = 60;
const MAX_PER_WINDOW = 20;

/**
 * `@fastify/rate-limit` only attaches to routes that exist, so a scanner hammering unknown paths
 * was never counted. This hook counts requests that fall through to the not-found handler, per
 * client IP. A real visitor with a stale link never gets near 20 a minute.
 *
 * It fails open on a Redis error: these are cheap 404s, unlike the auth routes, which fail closed.
 */
export function limitUnknownRoutes(instance: FastifyInstance, redis: Redis, trust: TrustFn): void {
  instance.addHook("onRequest", async (request, reply) => {
    if (!request.is404) return;
    const key = `rl:404:${clientIp(request, trust)}`;
    let count: number;
    try {
      const results = await redis.multi().incr(key).expire(key, WINDOW_SECONDS, "NX").exec();
      count = Number(results?.[0]?.[1]);
    } catch {
      return;
    }
    if (count > MAX_PER_WINDOW) {
      const error = new AppError(ErrorCode.RATE_LIMITED, {
        details: { retryAfterSeconds: WINDOW_SECONDS },
      });
      await reply.status(429).send(error.toResponse(requestLocale(request)));
    }
  });
}
