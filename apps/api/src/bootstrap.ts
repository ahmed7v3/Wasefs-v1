import "reflect-metadata";

import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DRUG_IMPORT_MAX_BYTES } from "@wasfa/shared/drugs";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { newId } from "@wasfa/shared/ids";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import { clientIp, compileTrust } from "./common/client-ip.js";
import { limitUnknownRoutes } from "./common/not-found-limit.js";
import { REDIS } from "./common/redis.js";

import type { ApiEnv } from "./config/env.js";
import type { ModuleMetadata } from "@nestjs/common";
import type { IncomingMessage } from "node:http";

/** Uploads go straight to R2 via presigned URLs, so JSON bodies never need more than this. */
export const BODY_LIMIT_BYTES = 1_048_576;

// Cloudflare ray ids look like `8f1c2a3b4d5e6f70-CAI`; anything else gets a fresh id instead.
const CF_RAY = /^[0-9a-f]{16}-[A-Z]{3}$/i;

function requestId(req: IncomingMessage): string {
  const ray = req.headers["cf-ray"];
  return typeof ray === "string" && CF_RAY.test(ray) ? ray : newId();
}

export interface CreateAppOptions {
  extraImports?: ModuleMetadata["imports"];
  /** `false` when the test provides its own `AUTH_MAILER`. */
  authMailer?: boolean;
}

/** Builds a fully configured (but not listening) API app. Shared by `main.ts` and tests. */
export async function createApp(
  env: ApiEnv,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const trust = compileTrust(env.TRUST_PROXY);
  const adapter = new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    // Only Caddy may set X-Forwarded-*; with an empty list nothing is trusted.
    trustProxy: env.TRUST_PROXY.length > 0 ? [...env.TRUST_PROXY] : false,
    genReqId: requestId,
    logger: false,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(env, options.extraImports, { authMailer: options.authMailer ?? true }),
    adapter,
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));

  await app.register(helmet, {
    // JSON API: nothing may be rendered, framed, or loaded from these responses.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  });

  // Only the drug import wizard posts multipart (one file, read lazily by that handler); every
  // other route keeps the 1 MB JSON limit. Guards run before the handler reads a single byte.
  await app.register(multipart, {
    limits: { fileSize: DRUG_IMPORT_MAX_BYTES, files: 1, fields: 5, fieldSize: 20_000, parts: 8 },
  });

  const allowedOrigins = new Set(env.WEB_ORIGIN);
  app.enableCors({
    // Exact match only: no wildcards, no regexes, no reflecting arbitrary origins.
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    redis: app.get(REDIS),
    nameSpace: "rl:",
    // A Redis outage must not take the whole API down; Cloudflare rate rules still apply.
    skipOnError: true,
    keyGenerator: (request) => clientIp(request, trust),
    errorResponseBuilder: (_request, context) =>
      new AppError(ErrorCode.RATE_LIMITED, {
        httpStatus: context.statusCode,
        details: { retryAfterSeconds: Math.ceil(context.ttl / 1000) },
      }),
  });

  limitUnknownRoutes(app.getHttpAdapter().getInstance(), app.get(REDIS), trust);

  // No custom Fastify error handler: Nest installs one at init that routes errors raised before
  // a handler runs (rate limit, body limit, bad JSON) through AllExceptionsFilter as well.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", async (request, reply) => {
      reply.header("x-request-id", String(request.id));
    });

  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  await app.init();
  return app;
}
