import {
  WA_CUSTOMER_OPTOUT_SET,
  WA_CUSTOMER_PREFS_LIST,
  waCustomerPrefCommandSchema,
} from "@wasfa/shared/customer-messages";
import { WA_REPLY_STREAM } from "@wasfa/shared/schemas/phone";
import { waAlertOptInSchema } from "@wasfa/shared/schemas/wa-alert";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";

import { routeInbound, type InboundRouterDeps } from "./agent-inbound.js";
import { type MediaIo } from "./agent-media.js";
import { type AgentSettingsSource } from "./agent-settings.js";
import { usePostgresAuthState } from "./auth-state.js";
import { recordIgnored } from "./inbound-diagnostics.js";
import {
  addressingOf,
  extractAlertOptInCommand,
  extractCustomerPrefCommand,
  isDirectJid,
  splitJid,
  type LidResolver,
  type RawMessage,
} from "./inbound.js";
import { createLidResolver } from "./lid-cache.js";

import type { BridgeSession, DisconnectKind, SocketHandle } from "./bridge.js";
import type { ReplyGuard } from "./guard.js";
import type { Database } from "@wasfa/db";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * The one file that talks to Baileys: it turns the stored credentials into a `BridgeSession` whose
 * sockets report the three events the lifecycle (bridge.ts) cares about.
 */

export interface BaileysSessionOptions {
  db: Database;
  key: Buffer;
  session: string;
  logger: Logger;
  redis: Redis;
  guard: ReplyGuard;
  /** The agent's switches (cached); the two features are independent. */
  agentSettings: AgentSettingsSource;
  /** Where inbound media is stored; null when uploads storage is not configured. */
  mediaStore: { put: MediaIo["put"] } | null;
}

function disconnectKind(status: number | undefined): DisconnectKind {
  if (status === DisconnectReason.loggedOut) return "logged_out";
  if (status === DisconnectReason.connectionReplaced) return "replaced";
  if (status === DisconnectReason.restartRequired) return "restart_required";
  return "other";
}

export function createBaileysSessionOpener(
  options: BaileysSessionOptions,
): () => Promise<BridgeSession> {
  const { db, key, session, logger, redis, guard, agentSettings, mediaStore } = options;

  async function handleMessages(
    socket: WASocket,
    messages: WAMessage[],
    router: InboundRouterDeps,
    resolver: LidResolver,
  ): Promise<void> {
    for (const message of messages) {
      const raw = message as unknown as RawMessage;
      const optIn = await extractAlertOptInCommand(raw, resolver);
      if (optIn) {
        const command = waAlertOptInSchema.parse(optIn);
        const messageId = raw.key.id;
        if (!messageId) continue;
        await guard.noteInbound(command.jid, messageId);
        await redis.lpush("wa:alert_optins", JSON.stringify(command));
        await redis.xadd(
          WA_REPLY_STREAM,
          "*",
          "data",
          JSON.stringify({
            inboundId: messageId,
            jid: command.jid,
            outcome: command.action === "optin" ? "alerts_on" : "alerts_off",
          }),
        );
        await socket.readMessages([message.key]).catch(() => undefined);
        logger.info("WhatsApp alert preference command queued");
        continue;
      }
      const preference = await extractCustomerPrefCommand(raw, resolver);
      if (preference) {
        const command = waCustomerPrefCommandSchema.parse(preference);
        const messageId = raw.key.id;
        if (!messageId) continue;
        await guard.noteInbound(command.jid, messageId);
        // Effective at once for anything already queued; the worker records it on the account.
        if (command.action === "stop") await redis.sadd(WA_CUSTOMER_OPTOUT_SET, command.jid);
        else await redis.srem(WA_CUSTOMER_OPTOUT_SET, command.jid);
        await redis.lpush(WA_CUSTOMER_PREFS_LIST, JSON.stringify(command));
        await redis.xadd(
          WA_REPLY_STREAM,
          "*",
          "data",
          JSON.stringify({
            inboundId: messageId,
            jid: command.jid,
            outcome: command.action === "stop" ? "messages_off" : "messages_on",
          }),
        );
        await socket.readMessages([message.key]).catch(() => undefined);
        logger.info({ action: command.action }, "WhatsApp customer preference command queued");
        continue;
      }
      // Codes, the agent and the owner's own messages: see agent-inbound.ts.
      try {
        const outcome = await routeInbound(raw, router, async () => {
          await socket.readMessages([message.key]);
        });
        if (outcome.route === "ignored") {
          await recordIgnored({ redis, logger }, outcome.reason, raw);
        }
      } catch (error) {
        logger.error(
          { reason: error instanceof Error ? error.name : "unknown" },
          "Routing an inbound message failed",
        );
      }
    }
  }

  return async () => {
    const auth = await usePostgresAuthState(db, key, session);
    return {
      existed: auth.existed,
      registered: auth.existed && auth.state.creds.registered === true,
      connect: async (onEvent) => {
        const latest = await fetchLatestBaileysVersion().catch(() => undefined);
        const baileysLogger = logger.child({ module: "baileys" }, { level: "error" });
        const socket = makeWASocket({
          ...(latest?.version ? { version: latest.version } : {}),
          auth: {
            creds: auth.state.creds,
            keys: makeCacheableSignalKeyStore(auth.state.keys, baileysLogger),
          },
          // Stable identity: always the same device name, never a changing browser string.
          browser: Browsers.ubuntu("Chrome"),
          logger: baileysLogger,
          markOnlineOnConnect: false,
          syncFullHistory: false,
          shouldSyncHistoryMessage: () => false,
          generateHighQualityLinkPreview: false,
          // Groups, statuses, broadcasts and newsletters never reach our handlers.
          shouldIgnoreJid: (jid) => {
            const direct = isDirectJid(jid);
            // A new kind of server (never the number) is worth one log line: it is how a sender
            // type that never reaches us would show up.
            const server = splitJid(jid)?.server ?? "none";
            if (!direct && !ignoredServers.has(server)) {
              ignoredServers.add(server);
              logger.info({ server }, "Inbound jid server ignored");
            }
            return !direct;
          },
          getMessage: () => Promise.resolve(undefined),
        });

        const ignoredServers = new Set<string>(["g.us", "broadcast", "newsletter", "call"]);
        const resolver = createLidResolver({
          redis,
          baileys: socket.signalRepository.lidMapping,
          logger,
        });

        const baileysDownload: MediaIo["download"] = async (raw) => {
          const buffer = await downloadMediaMessage(
            raw as unknown as WAMessage,
            "buffer",
            {},
            { logger: baileysLogger, reuploadRequest: socket.updateMediaMessage },
          );
          return buffer;
        };
        const router: InboundRouterDeps = {
          redis,
          guard,
          settings: agentSettings,
          resolver,
          media: mediaStore === null ? null : { download: baileysDownload, put: mediaStore.put },
          logger,
        };

        // After `end` nothing may touch the database: an unlink has just emptied the session.
        let ended = false;
        socket.ev.on("creds.update", () => {
          if (ended) return;
          void auth.saveCreds().catch((error: Error) => {
            logger.error({ reason: error.message }, "Saving WhatsApp credentials failed");
          });
        });
        socket.ev.on("messages.upsert", ({ messages, type }) => {
          if (ended) return;
          if (type !== "notify") {
            // Our own sends come back as "append"; anything from someone else is worth a count.
            for (const message of messages) {
              if (message.key.fromMe) continue;
              void recordIgnored({ redis, logger }, "not_notify", message as unknown as RawMessage);
            }
            return;
          }
          handleMessages(socket, messages, router, resolver).catch((error: Error) => {
            logger.error({ reason: error.message }, "Handling inbound messages failed");
          });
        });
        // WhatsApp tells us `lid <-> phone` pairs in several events; Baileys cannot look a LID up
        // later, so keep every pair (never anything from a message's text).
        socket.ev.on("lid-mapping.update", ({ lid, pn }) => {
          if (ended) return;
          void resolver.learn?.(lid, pn);
        });
        const learnFromContacts = (
          contacts: { id?: string; lid?: string; phoneNumber?: string }[],
        ) => {
          if (ended) return;
          for (const contact of contacts) {
            const lid =
              contact.lid ?? (addressingOf(contact.id) === "lid" ? contact.id : undefined);
            const pn =
              contact.phoneNumber ?? (addressingOf(contact.id) === "pn" ? contact.id : undefined);
            if (lid && pn) void resolver.learn?.(lid, pn);
          }
        };
        socket.ev.on("contacts.upsert", learnFromContacts);
        socket.ev.on("contacts.update", learnFromContacts);
        socket.ev.on("connection.update", (update) => {
          if (ended) return;
          if (update.qr) onEvent({ type: "qr" });
          if (update.connection === "open") onEvent({ type: "open" });
          if (update.connection === "close") {
            const status = (
              update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
            )?.output?.statusCode;
            onEvent({ type: "close", kind: disconnectKind(status) });
          }
        });

        const handle: SocketHandle = {
          requestPairingCode: (digits) => socket.requestPairingCode(digits),
          logout: () => socket.logout(),
          end: () => {
            ended = true;
            socket.end(undefined);
          },
          composing: async (jid) => {
            await socket.sendPresenceUpdate("composing", jid);
          },
          paused: async (jid) => {
            await socket.sendPresenceUpdate("paused", jid);
          },
          sendText: async (jid, text) => {
            await socket.sendMessage(jid, { text });
          },
          sendAgentText: async (jid, text) =>
            (await socket.sendMessage(jid, { text }))?.key.id ?? null,
          sendImage: async (jid, data, caption) =>
            (await socket.sendMessage(jid, { image: data, ...(caption ? { caption } : {}) }))?.key
              .id ?? null,
          sendDocument: async (jid, data, fileName, mimetype) =>
            (await socket.sendMessage(jid, { document: data, fileName, mimetype }))?.key.id ?? null,
          sendImageUrl: async (jid, url, caption) =>
            (await socket.sendMessage(jid, { image: { url }, ...(caption ? { caption } : {}) }))
              ?.key.id ?? null,
          sendDocumentUrl: async (jid, url, fileName, mimetype) =>
            (await socket.sendMessage(jid, { document: { url }, fileName, mimetype }))?.key.id ??
            null,
          sendVoice: async (jid, data) =>
            (
              await socket.sendMessage(jid, {
                audio: data,
                ptt: true,
                mimetype: "audio/ogg; codecs=opus",
              })
            )?.key.id ?? null,
        };
        return handle;
      },
    };
  };
}
