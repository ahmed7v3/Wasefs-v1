import { FakeAdapter, type FakeScript, type RouterEvent, type RouterInput } from "@wasfa/ai";

import type { AiRuntimeService } from "../../src/ai-runtime/ai-runtime.service.js";
import type { PinoLogger } from "nestjs-pino";

/*
 * Fakes for the WhatsApp agent's turn tests: the AI router backed by the scripted fake adapter, a
 * logger that records nothing, and the few Redis commands a turn uses, in memory.
 */

export interface FakeAiOptions {
  /** Cost the router reports for every call, USD micros. */
  costUsdMicros?: number;
  /** `assertAvailable` throws this when set (kill switch, daily cap). */
  unavailable?: Error;
}

export interface FakeAi {
  /** Pass this where an `AiRuntimeService` is expected. */
  service: AiRuntimeService;
  adapter: FakeAdapter;
  /** Every router input, in order. */
  inputs: RouterInput[];
}

export function fakeAi(script: FakeScript, options: FakeAiOptions = {}): FakeAi {
  const adapter = new FakeAdapter(script);
  const inputs: RouterInput[] = [];
  const cost = options.costUsdMicros ?? 0;
  const service = {
    assertAvailable: () =>
      options.unavailable ? Promise.reject(options.unavailable) : Promise.resolve(),
    async *run(input: RouterInput, signal: AbortSignal): AsyncGenerator<RouterEvent> {
      inputs.push(input);
      yield* adapter.stream({ ...input.request, model: "fake" }, signal);
      yield {
        type: "result",
        result: {
          outcome: "ok",
          modelId: "fake-model",
          routeVersion: 1,
          usage: undefined,
          costUsdMicros: cost,
          totalCostUsdMicros: cost,
          usageId: null,
          creditMultiplierBp: 10_000,
          attempts: 1,
        },
      };
    },
  } as unknown as AiRuntimeService;
  return { service, adapter, inputs };
}

export const silentLogger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

/** Redis commands the agent turn and the handoff use (SET with NX / EX / PX, counters, the unlock script). */
export class MemoryRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  set(key: string, value: string, ...flags: Array<string | number>): Promise<"OK" | null> {
    if (flags.includes("NX") && this.values.has(key)) return Promise.resolve(null);
    this.values.set(key, value);
    const unit = flags.find((flag) => flag === "EX" || flag === "PX");
    const amount = unit === undefined ? undefined : Number(flags[flags.indexOf(unit) + 1]);
    if (amount !== undefined) this.ttls.set(key, unit === "EX" ? amount * 1_000 : amount);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  getdel(key: string): Promise<string | null> {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return Promise.resolve(value);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(this.values.has(key) ? 1 : 0);
  }

  incrby(key: string, by: number): Promise<number> {
    const next = Number(this.values.get(key) ?? 0) + by;
    this.values.set(key, String(next));
    return Promise.resolve(next);
  }

  expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds * 1_000);
    return Promise.resolve(1);
  }

  /** Only the turn's unlock script: delete the key when it still holds the token. */
  eval(_script: string, _keys: number, key: string, token: string): Promise<number> {
    if (this.values.get(key) !== token) return Promise.resolve(0);
    this.values.delete(key);
    return Promise.resolve(1);
  }
}
