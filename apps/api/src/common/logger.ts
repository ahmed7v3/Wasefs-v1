import { LOG_REDACT_PATHS } from "@wasfa/shared/redact";
import { LoggerModule } from "nestjs-pino";

import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

/** pino-http request logging with secrets and personal data redacted. */
export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [API_ENV],
  useFactory: (env: ApiEnv) => ({
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
      // Health probes run every few seconds; logging them only adds noise.
      autoLogging: {
        // Under Fastify the middleware sees a mount-relative `url`; `originalUrl` is the real path.
        ignore: (req) => {
          const path = (req as { originalUrl?: string }).originalUrl ?? req.url ?? "";
          return path.startsWith("/health/");
        },
      },
      ...(env.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
        : {}),
    },
  }),
});
