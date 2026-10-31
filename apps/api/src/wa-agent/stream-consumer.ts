import { hostname } from "node:os";

import { type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { WA_AGENT_DLQ_STREAM } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";

import type { ApiEnv } from "../config/env.js";
import type { PinoLogger } from "nestjs-pino";

const BLOCK_MS = 2_000;
/** Entries a crashed consumer left unacknowledged are taken over after this long. */
const CLAIM_IDLE_MS = 60_000;
/** How often the pending list is looked at; an entry is only taken over once it is idle for `CLAIM_IDLE_MS`. */
const CLAIM_EVERY_MS = 5_000;
/** A v2 entry whose handler failed this many deliveries in a row goes to the dead-letter stream. */
export const MAX_DELIVERIES = 5;

type StreamBatch = [string, [string, string[]][]][] | null;

export interface StreamConsumerOptions {
  /** Reads `waAgent.runtime.v2`; absent = v1. */
  isV2?: () => Promise<boolean>;
  /** Copy the raw `data` field into a dead-letter row (only for streams that carry ids and statuses). */
  keepData?: boolean;
}

/**
 * A Redis stream consumer group reader, the shape of the OTP `InboundConsumer`: one blocking
 * connection of its own, stale entries claimed after a minute. Any number of api replicas can run;
 * each entry goes to one of them.
 *
 * v1 (`waAgent.runtime.v2` off): every entry is acknowledged whatever happens. v2: an entry is
 * acknowledged once `process` resolved. A throw leaves it pending, the idle claim redelivers it, and
 * after `MAX_DELIVERIES` failed deliveries it moves to `wa:agent:dlq` (ids only) and is acked.
 * Handlers must return, not throw, for a payload that can never succeed, and be idempotent.
 */
export abstract class StreamConsumer implements OnModuleInit, OnApplicationShutdown {
  private connection: Redis | undefined;
  private loop: Promise<void> | undefined;
  private stopped = false;
  private readonly consumerName = `${hostname()}-${process.pid}`;

  protected constructor(
    private readonly env: ApiEnv,
    protected readonly logger: PinoLogger,
    private readonly stream: string,
    private readonly group: string,
    private readonly options: StreamConsumerOptions = {},
  ) {}

  /** Handles one parsed JSON payload (null when the entry was not JSON). Throwing is retried in v2, logged only in v1. */
  abstract process(payload: unknown, entryId?: string): Promise<void>;

  async onModuleInit(): Promise<void> {
    // A blocking read needs its own connection, without the shared connection's command timeout.
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on("error", (error: Error) => {
      this.logger.error({ reason: error.message }, "Stream connection error");
    });
    try {
      await this.connection.xgroup("CREATE", this.stream, this.group, "$", "MKSTREAM");
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("BUSYGROUP"))) throw error;
    }
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    this.connection?.disconnect();
    await this.loop;
  }

  private async run(): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    let lastClaim = 0;
    while (!this.stopped) {
      try {
        if (Date.now() - lastClaim > CLAIM_EVERY_MS) {
          lastClaim = Date.now();
          await this.claimStale(connection);
        }
        const batch = (await connection.xreadgroup(
          "GROUP",
          this.group,
          this.consumerName,
          "COUNT",
          20,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          this.stream,
          ">",
        )) as StreamBatch;
        for (const [, entries] of batch ?? []) {
          for (const [id, fields] of entries) await this.handle(connection, id, fields);
        }
      } catch (error) {
        if (this.stopped) return;
        this.logger.error({ reason: (error as Error).message }, "Stream read failed");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  private async claimStale(connection: Redis): Promise<void> {
    const claimed = (await connection.xautoclaim(
      this.stream,
      this.group,
      this.consumerName,
      CLAIM_IDLE_MS,
      "0-0",
      "COUNT",
      50,
    )) as [string, [string, string[]][]];
    for (const [id, fields] of claimed[1] ?? []) {
      if (fields) await this.handle(connection, id, fields);
    }
  }

  private async handle(connection: Redis, id: string, fields: string[]): Promise<void> {
    const index = fields.indexOf("data");
    const raw = index >= 0 ? fields[index + 1] : undefined;
    let payload: unknown;
    try {
      payload = raw === undefined ? null : JSON.parse(raw);
    } catch {
      payload = null;
    }
    try {
      await this.process(payload, id);
    } catch (error) {
      this.logger.error({ reason: (error as Error).name }, "Handling stream entry failed");
      if (await this.isV2()) {
        await this.retryOrDeadLetter(connection, id, error, raw, payload);
        return;
      }
    }
    await connection.xack(this.stream, this.group, id);
  }

  protected async isV2(): Promise<boolean> {
    try {
      return (await this.options.isV2?.()) === true;
    } catch {
      return false;
    }
  }

  /** The entry stays pending (redelivered after the idle time) until it has failed `MAX_DELIVERIES` times. */
  private async retryOrDeadLetter(
    connection: Redis,
    id: string,
    error: unknown,
    raw: string | undefined,
    payload: unknown,
  ): Promise<void> {
    const pending = (await connection.xpending(this.stream, this.group, id, id, 1)) as [
      string,
      string,
      number,
      number,
    ][];
    const deliveries = pending[0]?.[3] ?? 1;
    if (deliveries < MAX_DELIVERIES) return;
    const row = [
      "stream",
      this.stream,
      "id",
      id,
      "group",
      this.group,
      "errorClass",
      error instanceof Error ? error.name : "unknown",
      "deliveries",
      String(deliveries),
      "at",
      new Date().toISOString(),
      ...this.deadLetterExtra(raw, payload),
    ];
    await connection.xadd(WA_AGENT_DLQ_STREAM, "*", ...row);
    await connection.xack(this.stream, this.group, id);
    this.logger.error(
      { stream: this.stream, entryId: id, deliveries },
      "Stream entry dead-lettered",
    );
  }

  /** Streams of ids and statuses keep their `data`; any other keeps only two non-text fields (never a phone or a message). */
  private deadLetterExtra(raw: string | undefined, payload: unknown): string[] {
    if (this.options.keepData === true) return raw === undefined ? [] : ["data", raw];
    const extra: string[] = [];
    if (typeof payload === "object" && payload !== null) {
      for (const key of ["waMessageId", "kind"] as const) {
        const value = (payload as Record<string, unknown>)[key];
        if (typeof value === "string") extra.push(key, value.slice(0, 128));
      }
    }
    return extra;
  }
}
