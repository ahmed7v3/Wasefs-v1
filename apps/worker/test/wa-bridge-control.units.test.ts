import {
  WA_COMMANDS_KEY,
  WA_HEARTBEAT_KEY,
  WA_PAIRING_KEY,
  waPairingSchema,
  type WaPairing,
} from "@wasfa/shared/schemas/phone";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WaBridge,
  type BridgeSession,
  type ConnectionEvent,
  type SocketHandle,
} from "../src/wa-bridge/bridge.js";
import { processCommand, runCommandLoop } from "../src/wa-bridge/commands.js";

import type { Redis } from "ioredis";

const NUMBER = "201555000111";
const CODE = "ABCD1234";

/** An in-memory stand-in for the three Redis calls the bridge makes. */
class FakeRedis {
  readonly values = new Map<string, { value: string; ttl: number | undefined }>();
  readonly lists = new Map<string, string[]>();

  set(key: string, value: string, mode?: string, ttl?: number): Promise<"OK"> {
    this.values.set(key, { value, ttl: mode === "EX" ? ttl : undefined });
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }

  lpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return Promise.resolve(list.length);
  }

  brpop(key: string): Promise<[string, string] | null> {
    const value = this.lists.get(key)?.pop();
    return Promise.resolve(value === undefined ? null : [key, value]);
  }

  pairing(): WaPairing | undefined {
    const stored = this.values.get(WA_PAIRING_KEY);
    return stored ? waPairingSchema.parse(JSON.parse(stored.value)) : undefined;
  }

  heartbeat(): string | undefined {
    return (
      JSON.parse(this.values.get(WA_HEARTBEAT_KEY)?.value ?? "null") as { state?: string } | null
    )?.state;
  }
}

class FakeSocket implements SocketHandle {
  ended = false;
  loggedOut = false;
  pairingNumbers: string[] = [];

  constructor(
    readonly emit: (event: ConnectionEvent) => void,
    private readonly failPairing: boolean,
  ) {}

  requestPairingCode(digits: string): Promise<string> {
    this.pairingNumbers.push(digits);
    return this.failPairing ? Promise.reject(new Error(`boom ${digits}`)) : Promise.resolve(CODE);
  }

  logout(): Promise<void> {
    this.loggedOut = true;
    return Promise.resolve();
  }

  end(): void {
    this.ended = true;
  }

  composing = () => Promise.resolve();
  paused = () => Promise.resolve();
  sendText = () => Promise.resolve();
  sendAgentText = () => Promise.resolve(null);
  sendImage = () => Promise.resolve(null);
  sendDocument = () => Promise.resolve(null);
  sendVoice = () => Promise.resolve(null);
}

/** The fake "database + Baileys" behind `openSession`. */
class World {
  stored: { registered: boolean } | undefined;
  sockets: FakeSocket[] = [];
  failPairing = false;
  cleared = 0;

  get last(): FakeSocket {
    const socket = this.sockets.at(-1);
    if (!socket) throw new Error("no socket was created");
    return socket;
  }

  openSession = (): Promise<BridgeSession> =>
    Promise.resolve({
      existed: this.stored !== undefined,
      registered: this.stored?.registered ?? false,
      connect: (onEvent) => {
        const socket = new FakeSocket(onEvent, this.failPairing);
        this.sockets.push(socket);
        return Promise.resolve(socket);
      },
    });

  clearSession = (): Promise<number> => {
    this.cleared += 1;
    const removed = this.stored ? 1 : 0;
    this.stored = undefined;
    return Promise.resolve(removed);
  };
}

function setup() {
  const lines: string[] = [];
  const logger = pino(
    { level: "trace" },
    {
      write: (line: string) => {
        lines.push(line);
      },
    },
  );
  const redis = new FakeRedis();
  const world = new World();
  const announced: string[] = [];
  const bridge = new WaBridge({
    redis: redis as unknown as Redis,
    logger,
    openSession: world.openSession,
    clearSession: world.clearSession,
    announceCode: (code) => announced.push(code),
  });
  const run = (raw: unknown) => processCommand(raw, bridge, logger);
  return { bridge, redis, world, lines, announced, run, logger };
}

/** Lets the fire-and-forget event handlers finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function emit(socket: FakeSocket, event: ConnectionEvent): Promise<void> {
  socket.emit(event);
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("processCommand", () => {
  it("drops anything that is not exactly a link with a number or an unlink", async () => {
    const { run, world } = setup();
    const junk: unknown[] = [
      null,
      "link",
      42,
      {},
      { id: "1", cmd: "reboot" },
      { id: "1", cmd: "link" },
      { id: "1", cmd: "link", number: "+201555000111" },
      { id: "1", cmd: "link", number: "12" },
      { id: "1", cmd: "link", number: "201555000111; rm -rf /" },
      { cmd: "unlink" },
      { id: "", cmd: "unlink" },
    ];
    for (const raw of junk) expect(await run(raw)).toBe("invalid");
    expect(world.sockets).toHaveLength(0);
  });

  it("runs a valid link and a valid unlink", async () => {
    const { run } = setup();
    expect(await run({ id: "a", cmd: "link", number: NUMBER })).toBe("link");
    expect(await run({ id: "b", cmd: "unlink" })).toBe("unlink");
  });
});

describe("link", () => {
  it("answers already_linked and touches nothing when a session is registered", async () => {
    const { run, world, redis } = setup();
    world.stored = { registered: true };
    await run({ id: "a", cmd: "link", number: NUMBER });
    expect(redis.pairing()).toEqual({ id: "a", cmd: "link", state: "already_linked" });
    expect(world.sockets).toHaveLength(0);
    expect(world.cleared).toBe(0);
  });

  it("requests a code for the number, publishes it masked with an expiry, and reports linked on open", async () => {
    const { run, world, redis, bridge } = setup();
    await run({ id: "a", cmd: "link", number: NUMBER });
    expect(world.sockets).toHaveLength(1);
    expect(redis.heartbeat()).toBe("connecting");

    await emit(world.last, { type: "qr" });
    expect(world.last.pairingNumbers).toEqual([NUMBER]);
    const pairing = redis.pairing();
    expect(pairing).toMatchObject({
      id: "a",
      cmd: "link",
      state: "code",
      code: CODE,
      number: "••••0111",
    });
    expect(pairing?.expiresAt).toBe(Date.now() + 180_000);
    expect(redis.values.get(WA_PAIRING_KEY)?.ttl).toBe(180);

    // A second qr event must not ask for a second code.
    await emit(world.last, { type: "qr" });
    expect(world.last.pairingNumbers).toHaveLength(1);

    await emit(world.last, { type: "open" });
    expect(redis.pairing()).toEqual({ id: "a", cmd: "link", state: "linked" });
    expect(bridge.connection).toBe("connected");

    // The pairing window no longer ends the (now linked) session.
    await vi.advanceTimersByTimeAsync(200_000);
    expect(world.last.ended).toBe(false);
  });

  it("never writes the pairing code to a log line", async () => {
    const { run, world, lines, announced } = setup();
    await run({ id: "a", cmd: "link", number: NUMBER });
    await emit(world.last, { type: "qr" });
    await emit(world.last, { type: "open" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(CODE);
    expect(lines.join("\n")).toContain("Pairing code issued");
    expect(announced).toEqual([]);
  });

  it("does not log the number or the upstream message when the code request fails", async () => {
    const { run, world, lines, redis } = setup();
    world.failPairing = true;
    await run({ id: "a", cmd: "link", number: NUMBER });
    await emit(world.last, { type: "qr" });
    expect(redis.pairing()).toEqual({
      id: "a",
      cmd: "link",
      state: "error",
      reason: "pairing_request_failed",
    });
    expect(world.last.ended).toBe(true);
    expect(lines.join("\n")).not.toContain(NUMBER);
  });

  it("gives up when nobody enters the code in time, leaving no half-linked session", async () => {
    const { run, world, redis, bridge } = setup();
    await run({ id: "a", cmd: "link", number: NUMBER });
    await emit(world.last, { type: "qr" });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(redis.pairing()).toMatchObject({ state: "error", reason: "timeout" });
    expect(world.last.ended).toBe(true);
    expect(bridge.connection).toBe("logged_out");
    expect(world.stored).toBeUndefined();
  });

  it("fails the pairing when the connection drops, but follows WhatsApp's own restart", async () => {
    const { run, world, redis } = setup();
    await run({ id: "a", cmd: "link", number: NUMBER });
    await emit(world.last, { type: "qr" });

    // After the code is entered WhatsApp restarts the socket: reconnect and carry on.
    await emit(world.last, { type: "close", kind: "restart_required" });
    expect(redis.pairing()?.state).toBe("code");
    await vi.advanceTimersByTimeAsync(600);
    expect(world.sockets).toHaveLength(2);
    await emit(world.last, { type: "open" });
    expect(redis.pairing()?.state).toBe("linked");

    // A different admin attempt that is cut off is an error.
    await run({ id: "b", cmd: "unlink" });
    world.stored = undefined;
    await run({ id: "c", cmd: "link", number: NUMBER });
    await emit(world.last, { type: "close", kind: "other" });
    expect(redis.pairing()).toMatchObject({ id: "c", state: "error", reason: "connection_closed" });
  });

  it("replaces a logged-out session without an unlink, and clears half-finished leftovers", async () => {
    const { run, world, redis, bridge } = setup();
    world.stored = { registered: true };
    await bridge.start();
    await emit(world.last, { type: "close", kind: "logged_out" });
    expect(bridge.connection).toBe("logged_out");
    expect(redis.values.has("wa:alert")).toBe(true);

    await run({ id: "a", cmd: "link", number: NUMBER });
    expect(world.cleared).toBe(1);
    expect(world.sockets).toHaveLength(2);
  });
});

describe("unlink", () => {
  it("logs the device out, forgets the session, goes idle and reports unlinked", async () => {
    const { run, world, redis, bridge } = setup();
    world.stored = { registered: true };
    await bridge.start();
    const socket = world.last;
    await emit(socket, { type: "open" });
    expect(bridge.connection).toBe("connected");

    await run({ id: "u", cmd: "unlink" });
    expect(socket.loggedOut).toBe(true);
    expect(socket.ended).toBe(true);
    expect(world.stored).toBeUndefined();
    expect(bridge.connection).toBe("logged_out");
    expect(redis.heartbeat()).toBe("logged_out");
    expect(redis.pairing()).toEqual({ id: "u", cmd: "unlink", state: "unlinked" });

    // The old socket's late close event (the logout itself) changes nothing and schedules nothing.
    await emit(socket, { type: "close", kind: "logged_out" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(world.sockets).toHaveLength(1);
    expect(redis.values.has("wa:alert")).toBe(false);
  });

  it("works with no socket at all", async () => {
    const { run, redis } = setup();
    await run({ id: "u", cmd: "unlink" });
    expect(redis.pairing()).toEqual({ id: "u", cmd: "unlink", state: "unlinked" });
  });

  it("reports an error when the session cannot be removed", async () => {
    const { redis, world, logger } = setup();
    world.stored = { registered: true };
    const failing = new WaBridge({
      redis: redis as unknown as Redis,
      logger,
      openSession: world.openSession,
      clearSession: () => Promise.reject(new Error("db down")),
    });
    await failing.unlink("u");
    expect(redis.pairing()).toEqual({
      id: "u",
      cmd: "unlink",
      state: "error",
      reason: "unlink_failed",
    });
  });
});

describe("the CLI link", () => {
  it("announces the code to the operator, not to the log, and signals when linked", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "trace" }, { write: (line: string) => void lines.push(line) });
    const redis = new FakeRedis();
    const world = new World();
    const announced: string[] = [];
    const linked = vi.fn();
    const bridge = new WaBridge({
      redis: redis as unknown as Redis,
      logger,
      openSession: world.openSession,
      clearSession: world.clearSession,
      announceCode: (code) => announced.push(code),
      onCliLinked: linked,
    });
    expect(await bridge.linkFromCli(NUMBER)).toBe("started");
    await emit(world.last, { type: "qr" });
    expect(announced).toEqual([CODE]);
    expect(lines.join("\n")).not.toContain(CODE);
    expect(redis.values.has(WA_PAIRING_KEY)).toBe(false);
    await emit(world.last, { type: "open" });
    expect(linked).toHaveBeenCalledOnce();
  });

  it("refuses when a number is already linked", async () => {
    const { bridge, world } = setup();
    world.stored = { registered: true };
    expect(await bridge.linkFromCli(NUMBER)).toBe("already_linked");
    expect(world.sockets).toHaveLength(0);
  });
});

describe("run without a session", () => {
  it("stays idle and reports logged_out instead of pairing by itself", async () => {
    const { bridge, world, redis } = setup();
    await bridge.start();
    expect(world.sockets).toHaveLength(0);
    expect(redis.heartbeat()).toBe("logged_out");
  });
});

describe("runCommandLoop", () => {
  it("handles queued commands in order, survives junk, and stops on abort", async () => {
    const { logger, redis } = setup();
    const seen: string[] = [];
    const target = {
      link: (id: string) => {
        seen.push(`link:${id}`);
        return Promise.resolve("started" as const);
      },
      unlink: (id: string) => {
        seen.push(`unlink:${id}`);
        return Promise.resolve();
      },
    };
    const abort = new AbortController();
    await redis.lpush(WA_COMMANDS_KEY, JSON.stringify({ id: "1", cmd: "link", number: NUMBER }));
    await redis.lpush(WA_COMMANDS_KEY, "not json");
    await redis.lpush(WA_COMMANDS_KEY, JSON.stringify({ id: "2", cmd: "unlink" }));
    const original = redis.brpop.bind(redis);
    // Stop once the list is drained.
    redis.brpop = async (key: string) => {
      const entry = await original(key);
      if (!entry) abort.abort();
      return entry;
    };
    await runCommandLoop({
      redis: redis as unknown as Redis,
      target,
      logger,
      signal: abort.signal,
    });
    expect(seen).toEqual(["link:1", "unlink:2"]);
  });
});
