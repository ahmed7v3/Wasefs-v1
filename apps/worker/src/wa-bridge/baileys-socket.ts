import { WA_INBOUND_MAXLEN, WA_INBOUND_STREAM } from "@wasfa/shared/schemas/phone";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";

import { usePostgresAuthState } from "./auth-state.js";
import { extractInbound, isDirectJid, type RawMessage } from "./inbound.js";

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
  const { db, key, session, logger, redis, guard } = options;

  async function handleMessages(socket: WASocket, messages: WAMessage[]): Promise<void> {
    for (const message of messages) {
      const result = await extractInbound(
        message as unknown as RawMessage,
        socket.signalRepository.lidMapping,
      );
      if (!result.ok) {
        logger.debug({ reason: result.reason }, "Inbound message ignored");
        continue;
      }
      await guard.noteInbound(result.message.jid, result.message.id);
      await socket.readMessages([message.key]).catch(() => undefined);
      await redis.xadd(
        WA_INBOUND_STREAM,
        "MAXLEN",
        "~",
        WA_INBOUND_MAXLEN,
        "*",
        "data",
        JSON.stringify(result.message),
      );
      // No phone number or code in the log line.
      logger.info("Inbound verification message queued");
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
          handleMessages(socket, messages).catch((error: Error) => {
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
        };
        return handle;
      },
    };
  };
}
