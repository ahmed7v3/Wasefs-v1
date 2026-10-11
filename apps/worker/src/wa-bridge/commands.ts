import { WA_COMMANDS_KEY, waCommandSchema } from "@wasfa/shared/schemas/phone";

import type { LinkResult } from "./bridge.js";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/** What the admin's commands can make the bridge do; `WaBridge` implements it. */
export interface CommandTarget {
  link: (id: string, digits: string) => Promise<LinkResult>;
  unlink: (id: string) => Promise<void>;
}

export type CommandResult = "link" | "unlink" | "invalid";

/**
 * Runs one entry of `wa:commands`. The payload is validated here, whatever put it on the list:
 * anything that is not exactly a `link` with a number or an `unlink` is dropped. Nothing about the
 * command (number, ids) goes into a log line.
 */
export async function processCommand(
  raw: unknown,
  target: CommandTarget,
  logger: Logger,
): Promise<CommandResult> {
  const parsed = waCommandSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("Malformed bridge command dropped");
    return "invalid";
  }
  const command = parsed.data;
  if (command.cmd === "link") {
    await target.link(command.id, command.number);
    return "link";
  }
  await target.unlink(command.id);
  return "unlink";
}

function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const BLOCK_SECONDS = 5;

/**
 * Pops `wa:commands` until `signal` aborts. `redis` must be a connection of its own: a blocking pop
 * would stall everything else on a shared one. Commands are handled one at a time, in order
 * (the api `LPUSH`es, this `BRPOP`s).
 */
export async function runCommandLoop(options: {
  redis: Redis;
  target: CommandTarget;
  logger: Logger;
  signal: AbortSignal;
}): Promise<void> {
  const { redis, target, logger, signal } = options;
  while (!signal.aborted) {
    let entry: [string, string] | null;
    try {
      entry = await redis.brpop(WA_COMMANDS_KEY, BLOCK_SECONDS);
    } catch (error) {
      if (signal.aborted) return;
      logger.error({ reason: (error as Error).message }, "Command list read failed");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    if (!entry) continue;
    try {
      await processCommand(parsePayload(entry[1]), target, logger);
    } catch (error) {
      // Not retried: a repeated link would request a second pairing code.
      logger.error({ reason: error instanceof Error ? error.name : "unknown" }, "Command failed");
    }
  }
}
