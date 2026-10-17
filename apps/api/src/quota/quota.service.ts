import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { busyLockKey, type BusyKind } from "@wasfa/shared/busy";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { ownerKey } from "../plans/plans.repo.js";
import { PlansService } from "../plans/plans.service.js";

import type { WalletOwner } from "@wasfa/db";
import type { AiMode, AiTask } from "@wasfa/shared/ai";

/** Counters live two days: a UTC day plus the margin for clock skew and late readers. */
export const QUOTA_COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;
/** Monthly counters: the longest UTC month plus the same margin. */
export const QUOTA_MONTH_COUNTER_TTL_SECONDS = 35 * 24 * 60 * 60;
/** A held lock frees itself after this long, so a crashed job never blocks a user for good. */
export const BUSY_LOCK_TTL_SECONDS = 600;

/** One rx analysis and one chat stream per user at a time (the key is shared with the worker, which frees the rx lock). */
export type { BusyKind };

export type QuotaOwner =
  { ownerUserId: string; ownerOrgId?: undefined } | { ownerOrgId: string; ownerUserId?: undefined };

export type QuotaCheckInput = QuotaOwner & {
  /** The acting user (the lock is theirs, whichever wallet pays). */
  userId: string;
  task: AiTask;
  mode: AiMode;
};

export interface QuotaTicket {
  /** Which lock this check took; `null` for tasks that are not limited to one at a time. */
  lock: BusyKind | null;
  /** Frees the lock. Safe to call twice. */
  release(): Promise<void>;
}

const counterKey = (owner: WalletOwner, task: AiTask, day: string) =>
  `quota:${ownerKey(owner)}:${task}:${day}`;
const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const utcMonth = (now: Date) => now.toISOString().slice(0, 7);

/** Prescription reading and chat are the long-running tasks; the small helper tasks run freely. */
export function busyKindOf(task: AiTask): BusyKind | null {
  switch (task) {
    case "rx_extract":
    case "rx_verify":
      return "rx";
    case "chat":
    case "deep_think":
      return "chat";
    default:
      return null;
  }
}

const ownerOf = (input: QuotaOwner): WalletOwner =>
  input.ownerUserId === undefined
    ? { type: "org", id: input.ownerOrgId }
    : { type: "user", id: input.ownerUserId };

/**
 * Who may start which AI task right now (phase2.md, Task 2.2): the plan's entitlement, the daily
 * cap per owner and task, and one long task at a time per user. It only says yes or no; credits
 * and the spend guard are separate gates.
 */
@Injectable()
export class QuotaService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly plans: PlansService,
  ) {}

  /**
   * Throws `PAYMENT_REQUIRED` (`plan_feature`) when the plan does not allow the task or mode,
   * `CONFLICT` (`busy`) when the user already has one running, and `QUOTA_EXCEEDED` (`daily_cap`
   * or `monthly_cap`) when today's or this UTC month's allowance is used up. On success the caller holds the lock and must call
   * `release()` when the work ends (success, failure or cancel); the day's count is spent.
   */
  async check(input: QuotaCheckInput, now = new Date()): Promise<QuotaTicket> {
    const owner = ownerOf(input);
    const entitlement = await this.plans.entitlement(owner, input.task);
    if (!entitlement?.allowed || !entitlement.modes.includes(input.mode)) {
      throw new AppError(ErrorCode.PAYMENT_REQUIRED, { details: { reason: "plan_feature" } });
    }

    // The lock first: a refused "busy" request must not spend any of the day's allowance.
    const kind = busyKindOf(input.task);
    if (kind !== null && !(await this.acquire(input.userId, kind))) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "busy" } });
    }

    const counted: string[] = [];
    try {
      if (entitlement.dailyCap !== null) {
        const key = counterKey(owner, input.task, utcDay(now));
        const [incremented] = (await this.redis
          .multi()
          .incr(key)
          .expire(key, QUOTA_COUNTER_TTL_SECONDS)
          .exec()) ?? [undefined];
        const used = incremented?.[1];
        if (typeof used !== "number") throw new Error("Quota counter unavailable");
        if (used > entitlement.dailyCap) {
          // Over: give the slot back so refused attempts never push the counter ever higher.
          await this.redis.decr(key);
          throw new AppError(ErrorCode.QUOTA_EXCEEDED, { details: { reason: "daily_cap" } });
        }
        counted.push(key);
      }
      if (entitlement.monthlyCap !== null) {
        const key = counterKey(owner, input.task, utcMonth(now));
        const [incremented] = (await this.redis
          .multi()
          .incr(key)
          .expire(key, QUOTA_MONTH_COUNTER_TTL_SECONDS)
          .exec()) ?? [undefined];
        const used = incremented?.[1];
        if (typeof used !== "number") throw new Error("Quota counter unavailable");
        if (used > entitlement.monthlyCap) {
          // Give back this month's slot and today's: a refused attempt spends neither.
          await this.redis.decr(key);
          for (const spent of counted) await this.redis.decr(spent);
          throw new AppError(ErrorCode.QUOTA_EXCEEDED, { details: { reason: "monthly_cap" } });
        }
      }
    } catch (error) {
      if (kind !== null) await this.release(input.userId, kind);
      throw error;
    }

    let released = false;
    return {
      lock: kind,
      release: async () => {
        if (released || kind === null) return;
        released = true;
        await this.release(input.userId, kind);
      },
    };
  }

  /** Frees a user's lock. The worker calls this when an rx job ends, with no ticket at hand. */
  async release(userId: string, kind: BusyKind): Promise<void> {
    await this.redis.del(busyLockKey(userId, kind));
  }

  /** How many of each task the owner has started today (for `GET /me/credits`). */
  async usedToday(
    owner: WalletOwner,
    tasks: readonly AiTask[],
    now = new Date(),
  ): Promise<Map<AiTask, number>> {
    const day = utcDay(now);
    const used = new Map<AiTask, number>();
    if (tasks.length === 0) return used;
    const values = await this.redis.mget(tasks.map((task) => counterKey(owner, task, day)));
    tasks.forEach((task, index) => {
      used.set(task, Math.max(0, Number(values[index] ?? 0)));
    });
    return used;
  }

  /** How many of each task the owner has started this UTC month (for `GET /me/credits`). */
  async usedThisMonth(
    owner: WalletOwner,
    tasks: readonly AiTask[],
    now = new Date(),
  ): Promise<Map<AiTask, number>> {
    const month = utcMonth(now);
    const used = new Map<AiTask, number>();
    if (tasks.length === 0) return used;
    const values = await this.redis.mget(tasks.map((task) => counterKey(owner, task, month)));
    tasks.forEach((task, index) => {
      used.set(task, Math.max(0, Number(values[index] ?? 0)));
    });
    return used;
  }

  private async acquire(userId: string, kind: BusyKind): Promise<boolean> {
    const result = await this.redis.set(
      busyLockKey(userId, kind),
      randomUUID(),
      "EX",
      BUSY_LOCK_TTL_SECONDS,
      "NX",
    );
    return result === "OK";
  }
}
