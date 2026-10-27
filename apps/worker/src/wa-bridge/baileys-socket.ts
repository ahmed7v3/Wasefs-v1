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
import {
  extractAlertOptInCommand,
  extractCustomerPrefCommand,
  isDirectJid,
  type RawMessage,
} from "./inbound.js";

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
  ): Promise<void> {
    for (const message of messages) {
      const raw = message as unknown as RawMessage;
      const optIn = await extractAlertOptInCommand(raw, socket.signalRepository.lidMapping);
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
      const preference = await extractCustomerPrefCommand(raw, socket.signalRepository.lidMapping);
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
          logger.debug({ reason: outcome.reason }, "Inbound message ignored");
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
          shouldIgnoreJid: (jid) => !isDirectJid(jid),
          getMessage: () => Promise.resolve(undefined),
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
          resolver: socket.signalRepository.lidMapping,
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
          if (ended || type !== "notify") return;
          handleMessages(socket, messages, router).catch((error: Error) => {
            logger.error({ reason: error.message }, "Handling inbound messages failed");
          });
        });
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
