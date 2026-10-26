import {
  WA_HEARTBEAT_KEY,
  WA_PAIRING_KEY,
  WA_PAIRING_TTL_SECONDS,
  maskWaNumber,
  type WaConnectionState,
  type WaPairing,
  type WaPairingError,
} from "@wasfa/shared/schemas/phone";

import type { AgentSocket } from "./agent-outbound.js";
import type { ReplySocket } from "./replies.js";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * The bridge's connection lifecycle, with every outside thing (Baileys, Postgres, Redis) behind a
 * small interface so it is testable with a fake socket. It owns exactly one socket at a time. The
 * only ways a number gets linked are an explicit operator action: the `link` CLI or the admin's
 * `link` command. After a logout it stays idle and never pairs again on its own.
 */

export type DisconnectKind = "logged_out" | "replaced" | "restart_required" | "other";

export type ConnectionEvent =
  { type: "qr" } | { type: "open" } | { type: "close"; kind: DisconnectKind };

/** What the lifecycle needs from a live WhatsApp socket. */
export interface SocketHandle extends ReplySocketMethods, AgentSocketMethods {
  requestPairingCode: (digits: string) => Promise<string>;
  logout: () => Promise<void>;
  /** Closes the socket for good: after this it must not save credentials or report events. */
  end: () => void;
}

type ReplySocketMethods = Omit<ReplySocket, "isConnected">;
/** Typing presence is shared with the reply socket; the rest is what only the agent sends. */
type AgentSocketMethods = Omit<AgentSocket, "isConnected" | "composing" | "paused">;

/** The stored credentials, opened once; `connect` turns them into a socket. */
export interface BridgeSession {
  /** Credentials were stored before. */
  existed: boolean;
  /** WhatsApp accepted the pairing (the stored credentials are a linked device). */
  registered: boolean;
  connect: (onEvent: (event: ConnectionEvent) => void) => Promise<SocketHandle>;
}

export interface BridgeDeps {
  redis: Pick<Redis, "set" | "del">;
  logger: Logger;
  openSession: () => Promise<BridgeSession>;
  clearSession: () => Promise<number>;
  /** Shows a pairing code to the operator who ran the `link` CLI (never to a log). */
  announceCode?: (code: string) => void;
  /** The `link` CLI is done once the number is linked. */
  onCliLinked?: () => void;
}

export type LinkResult = "started" | "already_linked";

interface Pairing {
  id: string;
  digits: string;
  source: "cli" | "command";
  codeRequested: boolean;
  timer?: NodeJS.Timeout;
}

const PAIRING_WINDOW_MS = WA_PAIRING_TTL_SECONDS * 1_000;
const STABLE_AFTER_MS = 60_000;

export class WaBridge {
  private state: WaConnectionState = "connecting";
  private handle: SocketHandle | undefined;
  /** Bumped whenever the current socket is dropped: events from older sockets are ignored. */
  private generation = 0;
  private attempt = 0;
  private stopped = false;
  private pairing: Pairing | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stableTimer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: BridgeDeps) {}

  /** What the reply loop may use: connected, and a socket exists. */
  readonly replySocket: ReplySocket = {
    isConnected: () => this.state === "connected" && this.handle !== undefined,
    composing: async (jid) => {
      await this.handle?.composing(jid);
    },
    paused: async (jid) => {
      await this.handle?.paused(jid);
    },
    sendText: async (jid, text) => {
      await this.handle?.sendText(jid, text);
    },
  };

  /** What the agent's outbound loop may use: same connection rule as `replySocket`. */
  readonly agentSocket: AgentSocket = {
    isConnected: () => this.state === "connected" && this.handle !== undefined,
    composing: async (jid) => {
      await this.handle?.composing(jid);
    },
    paused: async (jid) => {
      await this.handle?.paused(jid);
    },
    sendAgentText: (jid, text) => this.live().sendAgentText(jid, text),
    sendImage: (jid, data, caption) => this.live().sendImage(jid, data, caption),
    sendDocument: (jid, data, fileName, mimetype) =>
      this.live().sendDocument(jid, data, fileName, mimetype),
    sendVoice: (jid, data) => this.live().sendVoice(jid, data),
  };

  /** The socket, or an error: an agent send must fail loudly (its verdict is reported), never vanish. */
  private live(): SocketHandle {
    if (this.state !== "connected" || this.handle === undefined) {
      throw new Error("WhatsApp is not connected");
    }
    return this.handle;
  }

  get connection(): WaConnectionState {
    return this.state;
  }

  /** `run`: connect with the stored session, or idle when there is none. */
  async start(): Promise<void> {
    await this.connect();
  }

  /** The `link <n>` CLI. */
  async linkFromCli(digits: string): Promise<LinkResult> {
    const session = await this.deps.openSession();
    if (session.existed && session.registered) return "already_linked";
    this.pairing = { id: "cli", digits, source: "cli", codeRequested: false };
    await this.connect();
    return "started";
  }

  /** The admin's `link` command. The outcome is reported through `wa:pairing`. */
  async link(id: string, digits: string): Promise<LinkResult> {
    try {
      const session = await this.deps.openSession();
      // A logged-out session is dead (WhatsApp revoked it), so it may be replaced without an unlink.
      if (session.registered && this.state !== "logged_out") {
        await this.writePairing({ id, cmd: "link", state: "already_linked" });
        return "already_linked";
      }
      this.cancelPairing();
      await this.dropSocket();
      // Leftovers of an earlier half-finished pairing or a revoked session must not be reused.
      if (session.existed) await this.deps.clearSession();
      this.attempt = 0;
      this.pairing = { id, digits, source: "command", codeRequested: false };
      await this.connect();
    } catch (error) {
      this.deps.logger.error({ reason: errorName(error) }, "Starting the pairing failed");
      this.cancelPairing();
      await this.dropSocket().catch(() => undefined);
      await this.writePairing({
        id,
        cmd: "link",
        state: "error",
        reason: "pairing_request_failed",
      });
    }
    return "started";
  }

  /** The admin's `unlink` command: log the device out, forget the session, stay idle. */
  async unlink(id: string): Promise<void> {
    this.cancelPairing();
    try {
      await this.dropSocket({ logout: true });
      const removed = await this.deps.clearSession();
      await this.publish("logged_out");
      await this.deps.redis.del("wa:alert").catch(() => undefined);
      this.deps.logger.warn({ removed }, "Linked WhatsApp session removed by an admin");
      await this.writePairing({ id, cmd: "unlink", state: "unlinked" });
    } catch (error) {
      this.deps.logger.error({ reason: errorName(error) }, "Unlinking failed");
      await this.writePairing({ id, cmd: "unlink", state: "error", reason: "unlink_failed" });
    }
  }

  /** Writes the heartbeat; the bridge calls it every 30 s and on every state change. */
  async publish(next: WaConnectionState = this.state): Promise<void> {
    this.state = next;
    await this.deps.redis
      .set(WA_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), state: next }), "EX", 120)
      .catch((error: Error) => {
        this.deps.logger.error({ reason: error.message }, "Heartbeat write failed");
      });
  }

  async stop(reportState: boolean): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelPairing();
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    if (reportState) await this.publish("disconnected");
    await this.dropSocket();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const generation = this.generation;
    const session = await this.deps.openSession();
    if (!session.existed && !this.pairing) {
      this.deps.logger.error(
        "No linked WhatsApp session: link a number from /admin/whatsapp (or run `link <number>`). Staying idle.",
      );
      await this.publish("logged_out");
      return;
    }
    await this.publish("connecting");
    const handle = await session.connect((event) => {
      void this.onEvent(generation, event).catch((error: Error) => {
        this.deps.logger.error({ reason: error.message }, "Connection update failed");
      });
    });
    if (generation !== this.generation || this.stopped) {
      // Superseded (unlink, a new link, shutdown) while the socket was being created.
      handle.end();
      return;
    }
    this.handle = handle;
  }

  private async onEvent(generation: number, event: ConnectionEvent): Promise<void> {
    if (generation !== this.generation || this.stopped) return;
    if (event.type === "qr") return this.requestCode();
    if (event.type === "open") return this.onOpen();
    return this.onClose(event.kind);
  }

  private async requestCode(): Promise<void> {
    const pairing = this.pairing;
    if (!pairing || pairing.codeRequested || !this.handle) return;
    pairing.codeRequested = true;
    let code: string;
    try {
      code = await this.handle.requestPairingCode(pairing.digits);
    } catch (error) {
      this.deps.logger.error({ reason: errorName(error) }, "Requesting a pairing code failed");
      if (pairing.source === "command") await this.abortPairing("pairing_request_failed");
      return;
    }
    // Never in a log line: the code is a short-lived secret.
    this.deps.logger.info("Pairing code issued");
    if (pairing.source === "cli") {
      this.deps.announceCode?.(code);
      return;
    }
    await this.writePairing({
      id: pairing.id,
      cmd: "link",
      state: "code",
      code,
      number: maskWaNumber(pairing.digits),
      expiresAt: Date.now() + PAIRING_WINDOW_MS,
    });
    pairing.timer = setTimeout(() => {
      void this.abortPairing("timeout");
    }, PAIRING_WINDOW_MS);
  }

  private async onOpen(): Promise<void> {
    await this.publish("connected");
    clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.attempt = 0;
    }, STABLE_AFTER_MS);
    this.deps.logger.info("WhatsApp connected");
    const pairing = this.pairing;
    if (!pairing) return;
    this.cancelPairing();
    if (pairing.source === "command") {
      await this.writePairing({ id: pairing.id, cmd: "link", state: "linked" });
      this.deps.logger.warn("WhatsApp number linked from the admin");
    } else {
      this.deps.logger.warn("Linked. Credentials are saved; stopping the link command.");
      this.deps.onCliLinked?.();
    }
  }

  private async onClose(kind: DisconnectKind): Promise<void> {
    clearTimeout(this.stableTimer);
    // Right after the code is entered WhatsApp restarts the socket on purpose; any other close
    // during an admin-started pairing means it failed.
    if (this.pairing?.source === "command" && kind !== "restart_required") {
      await this.abortPairing("connection_closed");
      return;
    }
    if (kind === "logged_out") {
      // Never re-pair on our own: the owner may have removed the device on purpose.
      await this.publish("logged_out");
      await this.deps.redis.set("wa:alert", "logged_out").catch(() => undefined);
      this.deps.logger.error(
        "WhatsApp logged this device out. Phone verification is unavailable until a number is linked again from /admin/whatsapp.",
      );
      return;
    }
    await this.publish("disconnected");
    if (kind === "replaced") {
      this.deps.logger.error(
        "Another session replaced this one; waiting 5 minutes before retrying",
      );
      this.scheduleReconnect(5 * 60_000);
    } else if (kind === "restart_required") {
      this.scheduleReconnect(500);
    } else {
      this.scheduleReconnect(Math.min(60_000, 1_000 * 2 ** this.attempt++));
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.deps.logger.info({ delayMs }, "Reconnecting to WhatsApp");
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error: Error) => {
        this.deps.logger.error({ reason: error.message }, "Reconnect failed");
      });
    }, delayMs);
  }

  /** Gives up an admin-started pairing: nothing half-linked is left behind. */
  private async abortPairing(reason: WaPairingError): Promise<void> {
    const pairing = this.pairing;
    if (!pairing) return;
    this.cancelPairing();
    await this.dropSocket();
    await this.deps.clearSession().catch(() => undefined);
    await this.publish("logged_out");
    this.deps.logger.warn({ reason }, "Pairing aborted");
    if (pairing.source === "command") {
      await this.writePairing({ id: pairing.id, cmd: "link", state: "error", reason });
    }
  }

  private cancelPairing(): void {
    clearTimeout(this.pairing?.timer);
    this.pairing = undefined;
  }

  /** Detaches and closes the current socket (with a logout when asked); its late events are ignored. */
  private async dropSocket(options: { logout?: boolean } = {}): Promise<void> {
    this.generation += 1;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.stableTimer);
    const handle = this.handle;
    this.handle = undefined;
    if (!handle) return;
    if (options.logout) await handle.logout().catch(() => undefined);
    handle.end();
  }

  private async writePairing(value: WaPairing): Promise<void> {
    await this.deps.redis
      .set(WA_PAIRING_KEY, JSON.stringify(value), "EX", WA_PAIRING_TTL_SECONDS)
      .catch((error: Error) => {
        this.deps.logger.error({ reason: error.message }, "Pairing status write failed");
      });
  }
}

/** The error's class name only: messages from upstream libraries are not trusted to be free of data. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
