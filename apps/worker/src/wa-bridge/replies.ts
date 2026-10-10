import { WA_REPLY_STREAM, replyRequestSchema, replyText } from "@wasfa/shared/schemas/phone";

import { type DenyReason, type ReplyGuard } from "./guard.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

/** What the bridge needs from a connected WhatsApp socket to answer: nothing else is exposed to this module. */
export interface ReplySocket {
  isConnected: () => boolean;
  composing: (jid: string) => Promise<void>;
  paused: (jid: string) => Promise<void>;
  sendText: (jid: string, text: string) => Promise<void>;
}

export type ReplyResult = "sent" | "invalid" | "not_connected" | DenyReason;

export interface ReplyDeps {
  guard: ReplyGuard;
  socket: ReplySocket;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Answers one `wa:replies` entry, at most once. The text is chosen here from the outcome name: the
 * api cannot make the bridge say anything else. Every failure path is silent by design.
 */
export async function processReplyRequest(
  raw: unknown,
  { guard, socket, logger, sleep = defaultSleep }: ReplyDeps,
): Promise<ReplyResult> {
  const parsed = replyRequestSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  const { inboundId, jid, outcome } = parsed.data;
  if (!socket.isConnected()) return "not_connected";

  const text = replyText(outcome);
  const decision = await guard.authorize({ jid, inboundId, text });
  if (!decision.ok) {
    logger.info({ reason: decision.reason }, "Reply withheld");
    return decision.reason;
  }

  await socket.composing(jid);
  await sleep(decision.delayMs);
  await socket.sendText(jid, text);
  await socket.paused(jid).catch(() => undefined);
  await guard.recordSent();
  logger.info({ outcome, delayMs: decision.delayMs }, "Reply sent");
  return "sent";
}

const GROUP = "bridge";

/** The JSON in the `data` field of a stream entry, or null if it is missing or not JSON. */
function entryPayload(fields: string[]): unknown {
  const index = fields.indexOf("data");
  if (index < 0) return null;
  try {
    return JSON.parse(fields[index + 1] ?? "null");
  } catch {
    return null;
  }
}

/** Reads `wa:replies` until `signal` aborts; entries are acknowledged whatever the outcome. */
export async function runReplyLoop(options: {
  redis: Redis;
  consumer: string;
  deps: ReplyDeps;
  signal: AbortSignal;
}): Promise<void> {
  const { redis, consumer, deps, signal } = options;
  try {
    await redis.xgroup("CREATE", WA_REPLY_STREAM, GROUP, "$", "MKSTREAM");
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("BUSYGROUP"))) throw error;
  }
  while (!signal.aborted) {
    let batch: [string, [string, string[]][]][] | null;
    try {
      batch = (await redis.xreadgroup(
        "GROUP",
        GROUP,
        consumer,
        "COUNT",
        10,
        "BLOCK",
        5_000,
        "STREAMS",
        WA_REPLY_STREAM,
        ">",
      )) as typeof batch;
    } catch (error) {
      if (signal.aborted) return;
      deps.logger.error({ reason: (error as Error).message }, "Reply stream read failed");
      await defaultSleep(2_000);
      continue;
    }
    for (const [, entries] of batch ?? []) {
      for (const [id, fields] of entries) {
        const payload = entryPayload(fields);
        try {
          await processReplyRequest(payload, deps);
        } catch (error) {
          // A failed send is not retried: a second attempt could double-reply.
          deps.logger.warn({ reason: (error as Error).message }, "Reply failed");
        }
        await redis.xack(WA_REPLY_STREAM, GROUP, id);
      }
    }
  }
}
