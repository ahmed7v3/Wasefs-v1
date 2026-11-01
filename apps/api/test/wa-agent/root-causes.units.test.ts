import { settingDefault } from "@wasfa/shared/settings";
import { afterEach, describe, expect, vi } from "vitest";

import { LOCK_MS, WaAgentTurnService } from "../../src/wa-agent/agent/wa-agent-turn.service.js";
import { AgentRxService } from "../../src/wa-agent/commerce/agent-rx.service.js";
import { WaAgentEventsConsumer } from "../../src/wa-agent/commerce/wa-agent-events.consumer.js";
import {
  COMMERCE_CONVERSATION_ID,
  COMMERCE_USER_ID,
  commerceCall,
  quietLogger,
} from "../support/wa-agent-commerce-fakes.js";
import { MemoryRedis, silentLogger } from "../support/wa-agent-fakes.js";

import { redTest } from "./red.js";

import type { WaConversation } from "@wasfa/db";

/*
 * Red tests for the root causes of docs/WA-AGENT-RUNTIME.md §2 that live in the api and need no
 * containers: R9 (turn lock), R10 (rx start), R12 (rx_failed texts), R16 (files of a declined
 * prescription). Each states the correct v2 behaviour; see ./red.ts.
 */

const fake = <T>(value: object) => value as unknown as T;

afterEach(() => {
  vi.useRealTimers();
});

// --- R9: the turn lock is kept alive while a turn runs --------------------------------------------

/** MemoryRedis with expiry on the (fake) clock, and the few extra commands a lock heartbeat may use. */
class ExpiringRedis extends MemoryRedis {
  private readonly expiresAt = new Map<string, number>();

  private live(key: string): boolean {
    const at = this.expiresAt.get(key);
    if (at !== undefined && at <= Date.now()) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
    return this.values.has(key);
  }

  override set(key: string, value: string, ...flags: Array<string | number>): Promise<"OK" | null> {
    const exists = this.live(key);
    if (flags.includes("NX") && exists) return Promise.resolve(null);
    if (flags.includes("XX") && !exists) return Promise.resolve(null);
    const unit = flags.find((flag) => flag === "EX" || flag === "PX");
    const amount = unit === undefined ? undefined : Number(flags[flags.indexOf(unit) + 1]);
    this.values.set(key, value);
    if (amount !== undefined) {
      this.expiresAt.set(key, Date.now() + (unit === "EX" ? amount * 1_000 : amount));
    } else {
      this.expiresAt.delete(key);
    }
    return Promise.resolve("OK");
  }

  override get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key) ? (this.values.get(key) ?? null) : null);
  }

  override getdel(key: string): Promise<string | null> {
    const value = this.live(key) ? (this.values.get(key) ?? null) : null;
    this.values.delete(key);
    this.expiresAt.delete(key);
    return Promise.resolve(value);
  }

  override exists(key: string): Promise<number> {
    return Promise.resolve(this.live(key) ? 1 : 0);
  }

  pexpire(key: string, ms: number): Promise<number> {
    if (!this.live(key)) return Promise.resolve(0);
    this.expiresAt.set(key, Date.now() + ms);
    return Promise.resolve(1);
  }

  /** The unlock script (compare and delete) and a compare-and-extend heartbeat script. */
  override eval(script: string, keys: number, key: string, ...args: string[]): Promise<number> {
    const token = args[0];
    if (!this.live(key) || this.values.get(key) !== token) return Promise.resolve(0);
    if (/pexpire|expire/i.test(script)) {
      const ms = Number(args[1] ?? LOCK_MS);
      this.expiresAt.set(key, Date.now() + ms);
      return Promise.resolve(1);
    }
    return super.eval(script, keys, key, token ?? "");
  }
}

function lockHarness() {
  const redis = new ExpiringRedis();
  const gate: { release: () => void } = { release: () => undefined };
  const opened = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  const state = { turnsStarted: 0 };
  const service = new WaAgentTurnService(
    fake({ find: () => Promise.resolve(null) }),
    fake({
      // The first turn is "slow": it sits in its first read until the test lets it go.
      get: async () => {
        state.turnsStarted += 1;
        if (state.turnsStarted === 1) await opened;
        return { ...settingDefault("waAgent"), enabled: false };
      },
    }),
    fake(redis),
    fake({}),
    fake({}),
    fake({}),
    fake({}),
    fake({}),
    fake({}),
    silentLogger,
    fake({}),
  );
  return { service, redis, gate, state };
}

describe("R9 turn lock", () => {
  redTest(
    {
      id: "R9",
      fixedIn: "WP1",
      title: "a turn longer than the lock TTL keeps the lock",
      reason: /^R9: /,
    },
    async () => {
      vi.useFakeTimers({
        toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const { service, gate, state } = lockHarness();
      const first = service.onInbound(COMMERCE_CONVERSATION_ID);
      await vi.advanceTimersByTimeAsync(LOCK_MS + 5_000);
      const second = service.onInbound(COMMERCE_CONVERSATION_ID);
      await vi.advanceTimersByTimeAsync(1_000);
      const concurrent = state.turnsStarted;
      gate.release();
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.all([first, second]);
      expect(concurrent, "R9: a second handler after the TTL must not run a concurrent turn").toBe(
        1,
      );
    },
  );
});

// --- R10 / R16: analyze_prescription ---------------------------------------------------------------

const IMAGE = {
  id: "msg-1",
  kind: "image" as const,
  mediaKey: "wa/2026/10/abc12345",
  mediaMime: "image/jpeg",
  mediaBytes: 1234,
  createdAt: new Date("2026-10-26T09:50:00.000Z"),
};

interface RxSetup {
  metaError?: Error;
  fileStatus?: string;
}

function rxService(setup: RxSetup = {}) {
  const redis = new MemoryRedis();
  const claimed = new Set<string>();
  const released: string[] = [];
  const created: unknown[] = [];
  const fileCalls: Array<{ method: string; args: unknown[] }> = [];
  const config = settingDefault("rx");
  const baseFiles = {
    importObject: () => Promise.resolve("file-1"),
    awaitProcessed: () => Promise.resolve(setup.fileStatus ?? "processed"),
  };
  // Any other method (a delete or discard of imported files, whatever v2 calls it) is recorded.
  const files = new Proxy(baseFiles as Record<string, unknown>, {
    get(target, property) {
      if (typeof property !== "string") return undefined;
      if (property in target) return target[property];
      return (...args: unknown[]) => {
        fileCalls.push({ method: property, args });
        return Promise.resolve();
      };
    },
  });
  const service = new AgentRxService(
    fake({
      user: () =>
        Promise.resolve({
          id: COMMERCE_USER_ID,
          name: "منى",
          email: "m@example.com",
          emailVerified: true,
          phoneVerified: true,
          status: "active",
        }),
      newestUnusedMedia: () => Promise.resolve([IMAGE]),
      claimMedia: (id: string) => {
        if (claimed.has(id)) return Promise.resolve(false);
        claimed.add(id);
        return Promise.resolve(true);
      },
      releaseMedia: (id: string) => {
        released.push(id);
        claimed.delete(id);
        return Promise.resolve();
      },
      setMediaMeta: () => (setup.metaError ? Promise.reject(setup.metaError) : Promise.resolve()),
    }),
    fake(files),
    fake({
      create: (...args: unknown[]) => {
        created.push(args);
        return Promise.resolve({ id: "018f0000-0000-7000-8000-0000000000d1" });
      },
    }),
    fake({ entitlement: () => Promise.resolve({ maxPagesPerRx: null }) }),
    fake({ forUser: () => Promise.resolve({ wallet: { balance: 2 } }) }),
    fake({ get: () => Promise.resolve({ ...config, creditsPerPage: 3, maxPages: 2 }) }),
    fake(redis),
    quietLogger,
  );
  return { service, redis, claimed, released, created, fileCalls };
}

const RX_ID = "018f0000-0000-7000-8000-0000000000d1";

describe("R10 analyze_prescription", () => {
  redTest(
    {
      id: "R10",
      fixedIn: "WP1",
      title: "a started analysis keeps its claim and its route when the follow-up write fails",
      reason: /^R10: /,
    },
    async () => {
      const { service, redis, released, created } = rxService({
        metaError: new Error("meta write failed"),
      });
      const call = commerceCall();
      await service.analyze(call).catch(() => undefined);
      expect(created, "R10: the analysis was started").toHaveLength(1);
      expect(released, "R10: the media claim stays held for a created analysis").toEqual([]);
      expect(
        redis.values.get(`wa:agent:rx:${RX_ID}`),
        "R10: the started analysis is still routed to the conversation",
      ).toBe(COMMERCE_CONVERSATION_ID);
      await service.analyze(call).catch(() => undefined);
      expect(created, "R10: a retry of the same call starts no second analysis").toHaveLength(1);
    },
  );
});

describe("R16 declined prescription import", () => {
  redTest(
    {
      id: "R16",
      fixedIn: "WP1",
      title: "files imported for a declined request are deleted",
      reason: /^R16: /,
    },
    async () => {
      const { service, fileCalls } = rxService({ fileStatus: "rejected" });
      const result = await service.analyze(commerceCall());
      expect(result, "R16: the request is declined").toMatchObject({ started: false });
      const cleanup = fileCalls.filter(
        (entry) =>
          /delete|remove|discard|purge|cleanup/i.test(entry.method) &&
          JSON.stringify(entry.args).includes("file-1"),
      );
      expect(cleanup, "R16: the imported file is deleted from storage on decline").not.toHaveLength(
        0,
      );
    },
  );
});

// --- R12: rx_failed texts --------------------------------------------------------------------------

function eventsConsumer() {
  type SentPart = { kind: string; text?: string };
  const sent: Array<{ id: string; parts: SentPart[] }> = [];
  const redis = new MemoryRedis();
  redis.values.set(`wa:agent:rx:${RX_ID}`, COMMERCE_CONVERSATION_ID);
  const config = settingDefault("waAgent");
  const conversation = {
    id: COMMERCE_CONVERSATION_ID,
    userId: COMMERCE_USER_ID,
    status: "active",
  } as WaConversation;
  const consumer = new WaAgentEventsConsumer(
    fake({ WEB_ORIGIN: ["https://wasfa.online"], REDIS_URL: "redis://unused" }),
    quietLogger,
    fake({ find: () => Promise.resolve(conversation) }),
    fake({ recentConversation: () => Promise.resolve(conversation) }),
    fake({
      enqueue: (id: string, parts: SentPart[]) => {
        sent.push({ id, parts });
        return Promise.resolve(["m"]);
      },
    }),
    fake({}),
    fake({ get: () => Promise.resolve({ ...config, enabled: true }) }),
    fake(redis),
    fake({ remove: () => Promise.resolve() }),
  );
  consumer.timing.lockWaitMs = 0;
  return { consumer, sent };
}

async function failureText(event: Record<string, unknown>): Promise<string> {
  const { consumer, sent } = eventsConsumer();
  await consumer.process({ type: "rx_failed", rxId: RX_ID, ...event });
  return sent[0]?.parts[0]?.text ?? "";
}

describe("R12 rx_failed", () => {
  redTest(
    {
      id: "R12",
      fixedIn: "WP1",
      title: "an unreadable image and an internal error get different texts",
      reason: /^R12: /,
    },
    async () => {
      const unreadable = await failureText({ reason: "unreadable_image", creditsReturned: true });
      const internal = await failureText({ reason: "internal", creditsReturned: true });
      expect(unreadable, "R12: the unreadable-image text is sent").not.toBe("");
      expect(unreadable, "R12: unreadable image and internal error differ").not.toBe(internal);
    },
  );

  redTest(
    {
      id: "R12",
      fixedIn: "WP1",
      title: "the text never claims credits were returned unless the event says so",
      reason: /^R12: /,
    },
    async () => {
      const text = await failureText({ reason: "internal", creditsReturned: false });
      expect(text, "R12: a text is sent").not.toBe("");
      expect(text, "R12: no refund claim when credits were not returned").not.toContain("أعدنا");
    },
  );
});
