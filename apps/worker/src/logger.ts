import { LOG_REDACT_PATHS } from "@wasfa/shared/redact";
import { pino, type Logger } from "pino";

import type { WorkerEnv } from "./config/env.js";

/** pino logger with the same redaction rules as the API. */
export function createLogger(
  env: Pick<WorkerEnv, "LOG_LEVEL" | "NODE_ENV">,
  destination?: pino.DestinationStream,
): Logger {
  return pino(
    {
      name: "worker",
      level: env.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: "[REDACTED]" },
      ...(env.NODE_ENV === "development" && destination === undefined
        ? { transport: { target: "pino-pretty", options: { singleLine: true } } }
        : {}),
    },
    destination,
  );
}
