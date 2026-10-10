import { createDb } from "@wasfa/db";
import { decodeEncryptionKey } from "@wasfa/shared/crypto";
import {
  WA_HEARTBEAT_INTERVAL_MS,
  WA_HEARTBEAT_KEY,
  WA_INBOUND_MAXLEN,
  WA_INBOUND_STREAM,
  type WaConnectionState,
} from "@wasfa/shared/schemas/phone";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Redis } from "ioredis";

import { createLogger } from "../logger.js";

import { clearSession, usePostgresAuthState } from "./auth-state.js";
import { loadBridgeEnv } from "./config.js";
import { ReplyGuard } from "./guard.js";
import { extractInbound, isDirectJid, type RawMessage } from "./inbound.js";
import { runReplyLoop, type ReplySocket } from "./replies.js";

/*
 * The WhatsApp bridge: one long-running process, exactly one replica (a second device session on
 * the same credentials would fight the first). It listens for 1:1 text messages that contain a
 * 6-digit code and pushes {sender phone, code} to Redis; it never starts a conversation (guard.ts).
 *
 *   node dist/wa-bridge/main.js            run (default)
 *   node dist/wa-bridge/main.js link <n>   one-off: print a pairing code for the number <n> (digits, with country code)
 *   node dist/wa-bridge/main.js unlink     forget the linked session
 *
 * Linking is always a manual, one-off command. After `loggedOut` the bridge reports it and stays
 * idle: it never pairs again by itself.
 */

const env = loadBridgeEnv();
const logger = createLogger(env);
const [command = "run", argument] = process.argv.slice(2);

const { db, close: closeDb } = createDb({ url: env.DATABASE_URL, max: 3 });
const encryptionKey = decodeEncryptionKey(env.ENCRYPTION_KEY);

if (command === "unlink") {
  const removed = await clearSession(db, env.WA_SESSION);
  logger.warn({ removed }, "Linked WhatsApp session removed; run `link` to pair a number again");
  await closeDb();
  process.exit(0);
}
if (command !== "run" && command !== "link") {
  logger.fatal({ command }, "Unknown command (use run, link <number> or unlink)");
  process.exit(2);
}
const pairPhone = command === "link" ? (argument ?? "").replace(/\D/g, "") : undefined;
if (command === "link" && !/^\d{8,15}$/.test(pairPhone ?? "")) {
  logger.fatal("Usage: link <phone number with country code, digits only>");
  process.exit(2);
}

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
const blocking = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
for (const connection of [redis, blocking]) {
  connection.on("error", (error: Error) => {
    logger.error({ reason: error.message }, "Redis connection error");
  });
}
const guard = new ReplyGuard(redis);

let sock: WASocket | undefined;
let connection: WaConnectionState = "connecting";
let stopped = false;
let attempt = 0;
let pairingRequested = false;
let linkStarted = false;
let reconnectTimer: NodeJS.Timeout | undefined;
let stableTimer: NodeJS.Timeout | undefined;

async function publishState(next: WaConnectionState): Promise<void> {
  connection = next;
  await redis
    .set(WA_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), state: connection }), "EX", 120)
    .catch((error: Error) => {
      logger.error({ reason: error.message }, "Heartbeat write failed");
    });
}

const heartbeat = setInterval(() => {
  void publishState(connection);
}, WA_HEARTBEAT_INTERVAL_MS);

const replySocket: ReplySocket = {
  isConnected: () => connection === "connected" && sock !== undefined,
  composing: async (jid) => {
    await sock?.sendPresenceUpdate("composing", jid);
  },
  paused: async (jid) => {
    await sock?.sendPresenceUpdate("paused", jid);
  },
  sendText: async (jid, text) => {
    await sock?.sendMessage(jid, { text });
  },
};

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

function scheduleReconnect(delayMs: number): void {
  if (stopped) return;
  clearTimeout(reconnectTimer);
  logger.info({ delayMs }, "Reconnecting to WhatsApp");
  reconnectTimer = setTimeout(() => {
    void connect();
  }, delayMs);
}

async function connect(): Promise<void> {
  const auth = await usePostgresAuthState(db, encryptionKey, env.WA_SESSION);
  if (command === "run" && !auth.existed) {
    logger.error(
      "No linked WhatsApp session: run `node dist/wa-bridge/main.js link <number>` once. Staying idle.",
    );
    await publishState("logged_out");
    return;
  }
  // Only on the first connection: right after the code is entered WhatsApp closes the socket
  // (restartRequired) and the reconnect must finish the pairing with the credentials just saved.
  if (command === "link" && !linkStarted && auth.existed && auth.state.creds.registered) {
    logger.fatal("A session is already linked. Run `unlink` first to link another number.");
    process.exit(1);
  }
  linkStarted = true;

  const latest = await fetchLatestBaileysVersion().catch(() => undefined);
  const baileysLogger = logger.child({ module: "baileys" }, { level: "error" });
  await publishState("connecting");
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
  sock = socket;

  socket.ev.on("creds.update", () => {
    void auth.saveCreds().catch((error: Error) => {
      logger.error({ reason: error.message }, "Saving WhatsApp credentials failed");
    });
  });

  socket.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    handleMessages(socket, messages).catch((error: Error) => {
      logger.error({ reason: error.message }, "Handling inbound messages failed");
    });
  });

  socket.ev.on("connection.update", (update) => {
    void (async () => {
      if (update.qr && command === "link" && pairPhone && !pairingRequested) {
        pairingRequested = true;
        const code = await socket.requestPairingCode(pairPhone);
        // The only place a secret is logged on purpose: it is short-lived and meant for the operator.
        logger.warn(
          { pairingCode: code },
          "Enter this code in WhatsApp > Linked devices > Link with phone number instead",
        );
      }

      if (update.connection === "open") {
        await publishState("connected");
        clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          attempt = 0;
        }, 60_000);
        logger.info("WhatsApp connected");
        if (command === "link") {
          logger.warn("Linked. Credentials are saved; stopping the link command.");
          setTimeout(() => void shutdown("link done", 0), 8_000);
        }
      }

      if (update.connection === "close") {
        clearTimeout(stableTimer);
        const status = (
          update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;
        if (status === DisconnectReason.loggedOut) {
          // Never re-pair on our own: the owner may have removed the device on purpose.
          await publishState("logged_out");
          await redis.set("wa:alert", "logged_out").catch(() => undefined);
          logger.error(
            "WhatsApp logged this device out. Phone verification is unavailable until an operator runs `unlink` and `link`.",
          );
          return;
        }
        await publishState("disconnected");
        if (status === DisconnectReason.connectionReplaced) {
          logger.error("Another session replaced this one; waiting 5 minutes before retrying");
          scheduleReconnect(5 * 60_000);
        } else if (status === DisconnectReason.restartRequired) {
          scheduleReconnect(500);
        } else {
          scheduleReconnect(Math.min(60_000, 1_000 * 2 ** attempt++));
        }
      }
    })().catch((error: Error) => {
      logger.error({ reason: error.message }, "Connection update failed");
    });
  });
}

const replyAbort = new AbortController();
if (command === "run") {
  void runReplyLoop({
    redis: blocking,
    consumer: `bridge-${process.pid}`,
    deps: { guard, socket: replySocket, logger },
    signal: replyAbort.signal,
  }).catch((error: Error) => {
    logger.error({ reason: error.message }, "Reply loop stopped");
  });
}

async function shutdown(reason: string, code: number): Promise<void> {
  if (stopped) return;
  stopped = true;
  logger.info({ reason }, "WhatsApp bridge stopping");
  replyAbort.abort();
  clearInterval(heartbeat);
  clearTimeout(reconnectTimer);
  clearTimeout(stableTimer);
  if (command === "run") await publishState("disconnected");
  sock?.end(undefined);
  blocking.disconnect();
  await redis.quit().catch(() => {
    redis.disconnect();
  });
  await closeDb();
  process.exit(code);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal, 0);
  });
}
process.on("unhandledRejection", (reason) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason.message : String(reason) },
    "Unhandled rejection",
  );
  process.exit(1);
});

await connect();
logger.info({ command }, "WhatsApp bridge started");
