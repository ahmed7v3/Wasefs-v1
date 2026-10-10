import { RouteConfig } from "@nestjs/platform-fastify";

/** Stricter per-route limit on top of the global one, e.g. `@RateLimit(5, "1 minute")`. */
export const RateLimit = (max: number, timeWindow: string | number = "1 minute") =>
  RouteConfig({ rateLimit: { max, timeWindow } });

/** Exempts a route from rate limiting (health probes only). */
export const SkipRateLimit = () => RouteConfig({ rateLimit: false });
