import {
  WA_AGENT_IN_STREAM,
  WA_AGENT_STREAM_MAXLEN,
  WA_INBOUND_MAXLEN,
  WA_INBOUND_STREAM,
} from "@wasfa/shared/schemas/phone";
import {
  waAgentInboundSchema,
  waAgentLastInKey,
  waAgentSentIdKey,
  type WaAgentInbound,
} from "@wasfa/shared/schemas/wa-agent";

import { ingestMedia, agentContentOf, type MediaIo } from "./agent-media.js";
import { type AgentSettingsSource } from "./agent-settings.js";
import { INBOUND_WINDOW_SECONDS, type ReplyGuard } from "./guard.js";
import {
  MAX_INBOUND_AGE_MS,
  agentChatJid,
  chatPhone,
  extractInbound,
  isDirectJid,
  sentAtMs,
  type LidResolver,
  type RawMessage,
} from "./inbound.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * Where an inbound 1:1 message goes, after the bridge's own keyword commands (alert opt-in, STOP /
 * START) had their turn. The two switches are independent (docs/WA-AGENT.md section 7):
 *
 *   code, verification on         -> wa:inbound   (unchanged; with the agent off this is the only path)
 *   anything else, agent on       -> wa:agent:in  (text, image, voice note, PDF, other)
 *   the owner typing (fromMe)     -> wa:agent:in as `owner` unless the bridge itself sent it
 *   otherwise                     -> ignored
 */

export type RouteOutcome =
  | { route: "verification" }
  | { route: "agent"; kind: WaAgentInbound["kind"] }
  | { route: "owner" }
  | { route: "ignored"; reason: string };

export interface InboundRouterDeps {
  redis: Pick<Redis, "xadd" | "set" | "exists">;
  guard: Pick<ReplyGuard, "noteInbound">;
  settings: AgentSettingsSource;
  resolver: LidResolver;
  /** Null when uploads storage is not configured: media then arrives as kind `other`. */
  media: MediaIo | null;
  logger: Logger;
  now?: () => number;
}

const SEEN_TTL_SECONDS = 24 * 60 * 60;

const ignored = (reason: string): RouteOutcome => ({ route: "ignored", reason });

/** `markRead` is called for messages that were queued (the bridge shows them as read). */
export async function routeInbound(
  raw: RawMessage,
  deps: InboundRouterDeps,
  markRead: () => Promise<void>,
): Promise<RouteOutcome> {
  const now = (deps.now ?? Date.now)();
  const { agent, verificationOn } = await deps.settings.current();
  const agentOn = agent.enabled;

  if (raw.key.fromMe) {
    return agentOn ? routeOwner(raw, deps, now) : ignored("from_me");
  }

  const verification = await extractInbound(raw, deps.resolver, now);
  // With the agent off nothing changes: a code always goes to wa:inbound (the api honours its own switch).
  if (verification.ok && (!agentOn || verificationOn)) {
    await deps.guard.noteInbound(verification.message.jid, verification.message.id);
    await markRead().catch(() => undefined);
    await deps.redis.xadd(
      WA_INBOUND_STREAM,
      "MAXLEN",
      "~",
      WA_INBOUND_MAXLEN,
      "*",
      "data",
      JSON.stringify(verification.message),
    );
    // No phone number or code in the log line.
    deps.logger.info("Inbound verification message queued");
    return { route: "verification" };
  }
  if (!agentOn) return ignored(verification.ok ? "verification_off" : verification.reason);
  return routeToAgent(raw, deps, now, markRead);
}

async function firstSight(deps: InboundRouterDeps, id: string): Promise<boolean> {
  const claimed = await deps.redis.set(`wa:agent:seen:${id}`, "1", "EX", SEEN_TTL_SECONDS, "NX");
  return claimed === "OK";
}

async function routeOwner(
  raw: RawMessage,
  deps: InboundRouterDeps,
  now: number,
): Promise<RouteOutcome> {
  const { remoteJid, id } = raw.key;
  if (!isDirectJid(remoteJid)) return ignored("not_direct");
  if (!id) return ignored("no_id");
  // What the bridge sent itself comes back as a fromMe message: that is not the owner typing.
  if ((await deps.redis.exists(waAgentSentIdKey(id))) === 1) return ignored("own_sent");
  const sentAt = sentAtMs(raw, now);
  if (now - sentAt > MAX_INBOUND_AGE_MS) return ignored("stale");
  const content = agentContentOf(raw.message);
  if (content === null) return ignored("not_content");
  if (!(await firstSight(deps, id))) return ignored("duplicate");

  const phone = await chatPhone(raw, deps.resolver);
  await push(deps, {
    waMessageId: id,
    jid: agentChatJid(phone, remoteJid),
    phone,
    direction: "owner",
    kind: content.kind,
    ...(content.text ? { text: content.text } : {}),
    ts: sentAt,
  });
  // Only the fact, not the text or the number.
  deps.logger.info({ kind: content.kind }, "Owner message queued for the agent");
  return { route: "owner" };
}

async function routeToAgent(
  raw: RawMessage,
  deps: InboundRouterDeps,
  now: number,
  markRead: () => Promise<void>,
): Promise<RouteOutcome> {
  const { remoteJid, id } = raw.key;
  if (!isDirectJid(remoteJid)) return ignored("not_direct");
  if (!id) return ignored("no_id");
  const sentAt = sentAtMs(raw, now);
  if (now - sentAt > MAX_INBOUND_AGE_MS) return ignored("stale");
  const content = agentContentOf(raw.message);
  if (content === null) return ignored("not_content");
  if (!(await firstSight(deps, id))) return ignored("duplicate");

  const stored =
    content.kind === "image" || content.kind === "document" || content.kind === "audio"
      ? await ingestMedia(content, raw, deps.media, now)
      : { kind: content.kind };
  const phone = await chatPhone(raw, deps.resolver);
  const jid = agentChatJid(phone, remoteJid);
  const pushName = raw.pushName?.trim().slice(0, 100);
  await push(deps, {
    waMessageId: id,
    jid,
    phone,
    direction: "in",
    kind: stored.kind,
    ...(content.text ? { text: content.text } : {}),
    ...("media" in stored && stored.media ? { media: stored.media } : {}),
    ...(pushName ? { pushName } : {}),
    ts: sentAt,
  });
  // The 24 h window and the reply delay both count from the customer's last message.
  await deps.redis.set(waAgentLastInKey(jid), String(now), "EX", INBOUND_WINDOW_SECONDS);
  await markRead().catch(() => undefined);
  deps.logger.info({ kind: stored.kind }, "Inbound message queued for the agent");
  return { route: "agent", kind: stored.kind };
}

async function push(deps: InboundRouterDeps, entry: WaAgentInbound): Promise<void> {
  const valid = waAgentInboundSchema.parse(entry);
  await deps.redis.xadd(
    WA_AGENT_IN_STREAM,
    "MAXLEN",
    "~",
    WA_AGENT_STREAM_MAXLEN,
    "*",
    "data",
    JSON.stringify(valid),
  );
}
