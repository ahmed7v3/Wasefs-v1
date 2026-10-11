import { createDb } from "@wasfa/db";
import { decodeEncryptionKey } from "@wasfa/shared/crypto";
import { WA_HEARTBEAT_INTERVAL_MS } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";

import { createLogger } from "../logger.js";

import { clearSession } from "./auth-state.js";
import { createBaileysSessionOpener } from "./baileys-socket.js";
import { WaBridge } from "./bridge.js";
import { runCommandLoop } from "./commands.js";
import { loadBridgeEnv } from "./config.js";
import { ReplyGuard } from "./guard.js";
import { runReplyLoop } from "./replies.js";

/*
 * The WhatsApp bridge: one long-running process, exactly one replica (a second device session on
 * the same credentials would fight the first). It listens for 1:1 text messages that contain a
 * 6-digit code and pushes {sender phone, code} to Redis; it never starts a conversation (guard.ts).
 *
 *   node dist/wa-bridge/main.js            run (default): also obeys link/unlink commands from /admin/whatsapp
 *   node dist/wa-bridge/main.js link <n>   one-off: print a pairing code for the number <n> (digits, with country code)
 *   node dist/wa-bridge/main.js unlink     forget the linked session
 *
 * Linking is always a deliberate human action: the owner in /admin/whatsapp, or an operator running
 * `link`. After `loggedOut` the bridge reports it and stays idle: it never pairs again by itself.
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
// The command list is popped on a connection of its own, apart from the reply stream's.
const commandRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
for (const connection of [redis, blocking, commandRedis]) {
  connection.on("error", (error: Error) => {
    logger.error({ reason: error.message }, "Redis connection error");
  });
}
const guard = new ReplyGuard(redis);

const bridge = new WaBridge({
  redis,
  logger,
  openSession: createBaileysSessionOpener({
    db,
    key: encryptionKey,
    session: env.WA_SESSION,
    logger,
    redis,
    guard,
  }),
  clearSession: () => clearSession(db, env.WA_SESSION),
  // The operator's terminal, not a log line: a pairing code is a short-lived secret.
  announceCode: (code) => {
    process.stdout.write(
      `Pairing code: ${code}
Enter it in WhatsApp > Linked devices > Link with phone number instead
`,
    );
  },
  onCliLinked: () => {
    setTimeout(() => void shutdown("link done", 0), 8_000);
  },
});

const heartbeat = setInterval(() => {
  void bridge.publish();
}, WA_HEARTBEAT_INTERVAL_MS);

const loopAbort = new AbortController();
if (command === "run") {
  void runReplyLoop({
    redis: blocking,
    consumer: `bridge-${process.pid}`,
    deps: { guard, socket: bridge.replySocket, logger },
    signal: loopAbort.signal,
  }).catch((error: Error) => {
    logger.error({ reason: error.message }, "Reply loop stopped");
  });
  void runCommandLoop({
    redis: commandRedis,
    target: bridge,
    logger,
    signal: loopAbort.signal,
  }).catch((error: Error) => {
    logger.error({ reason: error.message }, "Command loop stopped");
  });
}

let stopping = false;
async function shutdown(reason: string, code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ reason }, "WhatsApp bridge stopping");
  loopAbort.abort();
  clearInterval(heartbeat);
  await bridge.stop(command === "run");
  blocking.disconnect();
  commandRedis.disconnect();
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

if (command === "link" && pairPhone) {
  if ((await bridge.linkFromCli(pairPhone)) === "already_linked") {
    logger.fatal("A session is already linked. Run `unlink` first to link another number.");
    await shutdown("already linked", 1);
  }
} else {
  await bridge.start();
}
logger.info({ command }, "WhatsApp bridge started");
