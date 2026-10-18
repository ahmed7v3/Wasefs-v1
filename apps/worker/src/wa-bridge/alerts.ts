import { waAlertPayloadSchema } from "@wasfa/shared/schemas/wa-alert";

import { AlertGuard } from "./alert-guard.js";

import type { ReplySocket } from "./replies.js";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runAlertLoop(input: {
  redis: Redis;
  guard: AlertGuard;
  socket: ReplySocket;
  logger: Logger;
  signal: AbortSignal;
}): Promise<void> {
  while (!input.signal.aborted) {
    const item = await input.redis.brpop("wa:alerts", 5);
    if (!item) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(item[1] ?? "null");
    } catch {
      continue;
    }
    const parsed = waAlertPayloadSchema.safeParse(raw);
    if (!parsed.success || !input.socket.isConnected()) continue;
    const { jid, text, dailyCap } = parsed.data;
    const authorization = await input.guard.authorize(jid, text, dailyCap);
    if (!authorization.ok) {
      input.logger.info({ reason: authorization.reason }, "WhatsApp alert dropped");
      continue;
    }
    await pause(authorization.delayMs);
    try {
      await input.socket.sendText(jid, text);
      await input.guard.recordSent();
    } catch {
      await input.guard.releaseReservation();
      input.logger.warn({ reason: "send_failed" }, "WhatsApp alert send failed");
      continue;
    }
    input.logger.info({ length: text.length }, "WhatsApp alert sent");
  }
}
