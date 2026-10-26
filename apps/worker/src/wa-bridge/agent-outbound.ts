import {
  WA_AGENT_OUT_STREAM,
  WA_AGENT_SENT_STREAM,
  WA_AGENT_STREAM_MAXLEN,
} from "@wasfa/shared/schemas/phone";
import {
  WA_AGENT_MAX_FILE_BYTES,
  WA_AGENT_SENT_ID_TTL_SECONDS,
  waAgentBlockKey,
  waAgentLastInKey,
  waAgentOutEntrySchema,
  waAgentPauseKey,
  isMediaOriginUrl,
  waAgentSentIdKey,
  waAgentSentSchema,
  type WaAgentDropReason,
  type WaAgentOutEntry,
  type WaAgentOutboundPart,
  type WaAgentSent,
} from "@wasfa/shared/schemas/wa-agent";

import { type AgentSettingsSource } from "./agent-settings.js";
import { INBOUND_WINDOW_SECONDS } from "./guard.js";
import { isDirectJid } from "./inbound.js";
import { reserveOutboundDelay } from "./outbound-spacing.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * The agent's way out (docs/WA-AGENT.md section 8, SECURITY.md section 8). The api asks; this module
 * decides whether WhatsApp may be told, in this order: the agent's switch, the 24 h window (a reply
 * only inside a chat the customer started), the owner's takeover pause and the block list, the
 * per-chat and daily caps (reserved atomically). Then "typing...", a human delay counted from the
 * customer's last message, and the parts one by one with the shared spacing. Every part gets exactly
 * one verdict on `wa:agent:sent`. Nothing here logs a phone number or a message text.
 */

/** The WhatsApp socket as the agent uses it; each send returns the WhatsApp message id. */
export interface AgentSocket {
  isConnected: () => boolean;
  composing: (jid: string) => Promise<void>;
  paused: (jid: string) => Promise<void>;
  sendAgentText: (jid: string, text: string) => Promise<string | null>;
  sendImage: (jid: string, data: Buffer, caption: string | undefined) => Promise<string | null>;
  sendDocument: (
    jid: string,
    data: Buffer,
    fileName: string,
    mimetype: string,
  ) => Promise<string | null>;
  /** A voice note (push-to-talk, ogg/opus). */
  sendVoice: (jid: string, data: Buffer) => Promise<string | null>;
  /** WhatsApp fetches the file itself: only urls of the public media library reach these two. */
  sendImageUrl: (jid: string, url: string, caption: string | undefined) => Promise<string | null>;
  sendDocumentUrl: (
    jid: string,
    url: string,
    fileName: string,
    mimetype: string,
  ) => Promise<string | null>;
}

/** The uploads bucket, read only (`ObjectStore` fits). */
export interface AgentStore {
  get: (key: string, maxBytes: number) => Promise<Buffer | null>;
}

export interface AgentOutboundDeps {
  redis: Pick<Redis, "get" | "exists" | "set" | "xadd" | "eval" | "decrby">;
  settings: AgentSettingsSource;
  socket: AgentSocket;
  store: AgentStore | null;
  logger: Logger;
  /** `MEDIA_PUBLIC_ORIGIN`: a part with a url is refused when it is not under it (or this is unset). */
  mediaOrigin?: string | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/** A reply is never held longer than this after it was dequeued. */
export const MAX_REPLY_WAIT_MS = 60_000;
/** Entries older than this were left behind by a restart: the moment has passed. */
export const AGENT_OUT_STALE_MS = 10 * 60_000;
const JITTER = 0.25;
const MIN_BETWEEN_PARTS_MS = 1_500;
const MAX_BETWEEN_PARTS_MS = 3_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * How long to wait before sending: until the customer's last message plus the configured delay
 * (plus or minus 25 %), never more than 60 s from now. `random` is in [0, 1).
 */
export function replyDelayMs(input: {
  lastInboundAt: number;
  now: number;
  replyDelaySeconds: number;
  random: number;
}): number {
  const jitter = 1 + (input.random * 2 - 1) * JITTER;
  const target = input.lastInboundAt + input.replyDelaySeconds * 1_000 * jitter;
  return Math.min(MAX_REPLY_WAIT_MS, Math.max(0, Math.round(target - input.now)));
}

// KEYS: chat-hour, chat-day, total-day counters; ARGV: parts, the three caps, the three TTLs.
// Returns 0 when the parts are reserved, else the 1-based index of the cap that would be exceeded.
const RESERVE_CAPS = `
local n = tonumber(ARGV[1])
for i = 1, 3 do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current + n > tonumber(ARGV[1 + i]) then return i end
end
for i = 1, 3 do
  redis.call('INCRBY', KEYS[i], n)
  redis.call('EXPIRE', KEYS[i], tonumber(ARGV[4 + i]))
end
return 0
`;

const CAP_REASONS = ["cap_chat_hour", "cap_chat_day", "cap_total_day"] as const;

function capKeys(jid: string, now: number): [string, string, string] {
  const iso = new Date(now).toISOString();
  const day = iso.slice(0, 10);
  const hour = iso.slice(0, 13);
  return [`wa:agent:cap:h:${jid}:${hour}`, `wa:agent:cap:d:${jid}:${day}`, `wa:agent:cap:t:${day}`];
}

async function reserveCaps(
  deps: AgentOutboundDeps,
  jid: string,
  parts: number,
  caps: { perChatPerHour: number; perChatPerDay: number; dailyTotal: number },
  now: number,
): Promise<WaAgentDropReason | null> {
  const result = Number(
    await deps.redis.eval(
      RESERVE_CAPS,
      3,
      ...capKeys(jid, now),
      String(parts),
      String(caps.perChatPerHour),
      String(caps.perChatPerDay),
      String(caps.dailyTotal),
      String(2 * 3_600),
      String(2 * 86_400),
      String(2 * 86_400),
    ),
  );
  return result === 0 ? null : (CAP_REASONS[result - 1] ?? "cap_total_day");
}

/** Gives back the reservation of parts that were not sent. */
async function releaseCaps(
  deps: AgentOutboundDeps,
  jid: string,
  parts: number,
  now: number,
): Promise<void> {
  if (parts <= 0) return;
  await Promise.all(capKeys(jid, now).map((key) => deps.redis.decrby(key, parts))).catch(
    () => undefined,
  );
}

async function holdReason(deps: AgentOutboundDeps, jid: string): Promise<WaAgentDropReason | null> {
  if ((await deps.redis.exists(waAgentPauseKey(jid))) === 1) return "paused";
  if ((await deps.redis.exists(waAgentBlockKey(jid))) === 1) return "blocked";
  return null;
}

async function report(deps: AgentOutboundDeps, verdict: WaAgentSent): Promise<void> {
  await deps.redis.xadd(
    WA_AGENT_SENT_STREAM,
    "MAXLEN",
    "~",
    WA_AGENT_STREAM_MAXLEN,
    "*",
    "data",
    JSON.stringify(waAgentSentSchema.parse(verdict)),
  );
}

async function dropAll(
  deps: AgentOutboundDeps,
  entry: WaAgentOutEntry,
  reason: WaAgentDropReason,
  from = 0,
): Promise<void> {
  for (const messageId of entry.messageIds.slice(from)) {
    await report(deps, { messageId, status: "dropped", reason });
  }
}

class MediaMissing extends Error {}

/** Parts that name a url instead of a stored upload, checked against the media origin. */
function urlsAllowed(parts: readonly WaAgentOutboundPart[], origin: string | undefined): boolean {
  return parts.every(
    (part) =>
      !("url" in part && part.url !== undefined) ||
      (origin !== undefined && isMediaOriginUrl(part.url, origin)),
  );
}

async function sendPart(
  deps: AgentOutboundDeps,
  jid: string,
  part: WaAgentOutboundPart,
): Promise<string | null> {
  if (part.kind === "text") return deps.socket.sendAgentText(jid, part.text);
  if (part.kind === "image" && part.url !== undefined) {
    return deps.socket.sendImageUrl(jid, part.url, part.caption);
  }
  if (part.kind === "document" && part.url !== undefined) {
    return deps.socket.sendDocumentUrl(jid, part.url, part.fileName, "application/pdf");
  }
  if (part.mediaKey === undefined) throw new MediaMissing();
  const data = await deps.store?.get(part.mediaKey, WA_AGENT_MAX_FILE_BYTES).catch(() => null);
  if (!data) throw new MediaMissing();
  if (part.kind === "image") return deps.socket.sendImage(jid, data, part.caption);
  if (part.kind === "document") {
    return deps.socket.sendDocument(jid, data, part.fileName, "application/pdf");
  }
  return deps.socket.sendVoice(jid, data);
}

export type AgentOutResult =
  | { outcome: "invalid" }
  | { outcome: "dropped"; reason: WaAgentDropReason }
  | { outcome: "sent"; sent: number };

/**
 * Handles one `wa:agent:out` entry. `streamId` (the Redis entry id) lets a restart's leftovers be
 * dropped as stale instead of answered late.
 */
export async function processAgentOut(
  raw: unknown,
  deps: AgentOutboundDeps,
  streamId?: string,
): Promise<AgentOutResult> {
  const parsed = waAgentOutEntrySchema.safeParse(raw);
  if (!parsed.success) return { outcome: "invalid" };
  const entry = parsed.data;
  const { jid } = entry;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const drop = async (reason: WaAgentDropReason): Promise<AgentOutResult> => {
    await dropAll(deps, entry, reason);
    deps.logger.info({ reason, parts: entry.parts.length }, "Agent reply withheld");
    return { outcome: "dropped", reason };
  };

  const enqueuedAt = streamId === undefined ? Number.NaN : Number(streamId.split("-")[0]);
  if (Number.isFinite(enqueuedAt) && now() - enqueuedAt > AGENT_OUT_STALE_MS) return drop("stale");
  if (!isDirectJid(jid)) return drop("invalid");
  if (!urlsAllowed(entry.parts, deps.mediaOrigin)) return drop("invalid");

  const { agent } = await deps.settings.current();
  if (!agent.enabled) return drop("disabled");
  if (!deps.socket.isConnected()) return drop("not_connected");

  // Reply-only: a chat the customer has not written to in the last 24 h gets nothing.
  const lastIn = Number((await deps.redis.get(waAgentLastInKey(jid))) ?? Number.NaN);
  if (!Number.isFinite(lastIn) || now() - lastIn > INBOUND_WINDOW_SECONDS * 1_000) {
    return drop("no_recent_inbound");
  }
  const held = await holdReason(deps, jid);
  if (held !== null) return drop(held);

  const reserved = await reserveCaps(deps, jid, entry.parts.length, agent.caps, now());
  if (reserved !== null) return drop(reserved);
  const reservedAt = now();

  try {
    if (agent.typingIndicator) await deps.socket.composing(jid).catch(() => undefined);
    await sleep(
      replyDelayMs({
        lastInboundAt: lastIn,
        now: now(),
        replyDelaySeconds: agent.replyDelaySeconds,
        random: random(),
      }),
    );
    // The owner may have taken over, or the agent been switched off, while "typing".
    const recheck = (await deps.settings.current()).agent.enabled
      ? await holdReason(deps, jid)
      : "disabled";
    if (recheck !== null) {
      await releaseCaps(deps, jid, entry.parts.length, reservedAt);
      await deps.socket.paused(jid).catch(() => undefined);
      return drop(recheck);
    }
  } catch {
    await releaseCaps(deps, jid, entry.parts.length, reservedAt);
    return drop("send_failed");
  }

  let sent = 0;
  for (const [index, part] of entry.parts.entries()) {
    const messageId = entry.messageIds[index];
    if (messageId === undefined) break;
    try {
      if (index > 0 && agent.typingIndicator)
        await deps.socket.composing(jid).catch(() => undefined);
      const between =
        index === 0
          ? 0
          : MIN_BETWEEN_PARTS_MS +
            Math.floor(random() * (MAX_BETWEEN_PARTS_MS - MIN_BETWEEN_PARTS_MS + 1));
      await sleep(await reserveOutboundDelay(deps.redis, between, now()));
      const waMessageId = await sendPart(deps, jid, part);
      if (waMessageId) {
        await deps.redis.set(
          waAgentSentIdKey(waMessageId),
          "1",
          "EX",
          WA_AGENT_SENT_ID_TTL_SECONDS,
        );
      }
      await deps.redis.set("wa:last-sent", String(now()), "EX", 3_600);
      await report(deps, {
        messageId,
        status: "sent",
        ...(waMessageId ? { waMessageId } : {}),
      });
      sent++;
    } catch (error) {
      if (error instanceof MediaMissing) {
        await report(deps, { messageId, status: "dropped", reason: "media_missing" });
        await releaseCaps(deps, jid, 1, reservedAt);
        continue;
      }
      // The connection is in doubt: stop here rather than send the rest out of order.
      await dropAll(deps, entry, "send_failed", index);
      await releaseCaps(deps, jid, entry.parts.length - index, reservedAt);
      deps.logger.warn({ part: part.kind }, "Agent reply send failed");
      break;
    }
  }
  await deps.socket.paused(jid).catch(() => undefined);
  deps.logger.info({ parts: entry.parts.length, sent }, "Agent reply processed");
  return { outcome: "sent", sent };
}

const GROUP = "bridge-agent";
const MAX_IN_FLIGHT = 20;

function entryPayload(fields: string[]): unknown {
  const index = fields.indexOf("data");
  if (index < 0) return null;
  try {
    return JSON.parse(fields[index + 1] ?? "null");
  } catch {
    return null;
  }
}

/**
 * Reads `wa:agent:out` until `signal` aborts. Replies wait for their delay concurrently (the shared
 * send spacing still serialises the actual sends); an entry is acknowledged whatever happens, so a
 * crash never leads to a second send.
 */
export async function runAgentOutLoop(options: {
  redis: Redis;
  consumer: string;
  deps: AgentOutboundDeps;
  signal: AbortSignal;
}): Promise<void> {
  const { redis, consumer, deps, signal } = options;
  try {
    await redis.xgroup("CREATE", WA_AGENT_OUT_STREAM, GROUP, "$", "MKSTREAM");
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("BUSYGROUP"))) throw error;
  }
  const inFlight = new Set<Promise<void>>();
  while (!signal.aborted) {
    if (inFlight.size >= MAX_IN_FLIGHT) {
      await Promise.race(inFlight);
      continue;
    }
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
        WA_AGENT_OUT_STREAM,
        ">",
      )) as typeof batch;
    } catch (error) {
      if (signal.aborted) break;
      deps.logger.error({ reason: (error as Error).message }, "Agent out stream read failed");
      await defaultSleep(2_000);
      continue;
    }
    for (const [, entries] of batch ?? []) {
      for (const [id, fields] of entries) {
        const task = processAgentOut(entryPayload(fields), deps, id)
          .catch((error: Error) => {
            deps.logger.warn({ reason: error.name }, "Agent reply failed");
          })
          .then(() => redis.xack(WA_AGENT_OUT_STREAM, GROUP, id))
          .then(
            () => undefined,
            () => undefined,
          )
          .finally(() => {
            inFlight.delete(task);
          });
        inFlight.add(task);
      }
    }
  }
  await Promise.allSettled(inFlight);
}
