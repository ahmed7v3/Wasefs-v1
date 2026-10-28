import {
  CLAIM_SCRIPT,
  CREATE_SCRIPT,
  SETTLE_SCRIPT,
  TAKE_SCRIPT,
} from "../../src/auth/whatsapp-login/wa-login.store.js";

import type { WhatsAppAccount } from "../../src/auth/whatsapp-login/whatsapp-login.repo.js";

/**
 * Redis for the "Continue with WhatsApp" store: hashes, counters and the four Lua scripts, which
 * are emulated in JS (same state machine, same arguments). The real scripts run in the int test.
 */
export class LoginRedis {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly values = new Map<string, string>();
  readonly counters = new Map<string, number>();
  readonly streams = new Map<string, unknown[]>();
  now = 1_800_000_000_000;

  eval(script: string, _keys: number, key: string, ...args: string[]): Promise<unknown> {
    const hash = this.hashes.get(key);
    if (script === CREATE_SCRIPT) {
      if (hash) return Promise.resolve(0);
      this.hashes.set(
        key,
        new Map([
          ["nonceHash", args[0] ?? ""],
          ["createdAt", args[1] ?? ""],
          ["status", "pending"],
          ["ua", args[2] ?? ""],
        ]),
      );
      return Promise.resolve(1);
    }
    if (script === CLAIM_SCRIPT) {
      const created = Number(hash?.get("createdAt"));
      if (!hash || Number.isNaN(created)) return Promise.resolve(0);
      if (hash.get("status") !== "pending") return Promise.resolve(0);
      if (Number(args[0]) - created > Number(args[1])) return Promise.resolve(0);
      hash.set("status", "claimed");
      return Promise.resolve(1);
    }
    if (script === SETTLE_SCRIPT) {
      if (hash?.get("status") !== "claimed") return Promise.resolve(0);
      hash.set("status", args[0] ?? "");
      hash.set("userId", args[1] ?? "");
      hash.set("isNew", args[2] ?? "");
      hash.set("reason", args[3] ?? "");
      return Promise.resolve(1);
    }
    if (script === TAKE_SCRIPT) {
      const status = hash?.get("status");
      if (!hash || !status) return Promise.resolve([]);
      if (status === "approved" || status === "refused") {
        const out = [
          status,
          hash.get("userId") ?? "",
          hash.get("isNew") ?? "",
          hash.get("reason") ?? "",
        ];
        this.hashes.delete(key);
        return Promise.resolve(out);
      }
      if (Number(args[0]) - Number(hash.get("createdAt")) > Number(args[1])) {
        this.hashes.delete(key);
        return Promise.resolve(["expired"]);
      }
      return Promise.resolve([status]);
    }
    return Promise.reject(new Error("unknown script"));
  }

  hget(key: string, field: string): Promise<string | null> {
    return Promise.resolve(this.hashes.get(key)?.get(field) ?? null);
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  multi() {
    const ops: Array<() => number> = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const next = (this.counters.get(key) ?? 0) + 1;
          this.counters.set(key, next);
          return next;
        });
        return chain;
      },
      expire: () => chain,
      exec: () => Promise.resolve(ops.map((run) => [null, run()])),
    };
    return chain;
  }

  xadd(stream: string, ...args: Array<string | number>): Promise<string> {
    const list = this.streams.get(stream) ?? [];
    list.push(JSON.parse(String(args.at(-1))) as unknown);
    this.streams.set(stream, list);
    return Promise.resolve("1-0");
  }

  replies(): Array<{ inboundId: string; jid: string; outcome: string }> {
    return (this.streams.get("wa:replies") ?? []) as Array<{
      inboundId: string;
      jid: string;
      outcome: string;
    }>;
  }
}

export function account(overrides: Partial<WhatsAppAccount> = {}): WhatsAppAccount {
  return {
    id: "user-1",
    name: "Mona",
    status: "active",
    twoFactorEnabled: false,
    anonymizedAt: null,
    hasPlatformRole: false,
    ...overrides,
  };
}
