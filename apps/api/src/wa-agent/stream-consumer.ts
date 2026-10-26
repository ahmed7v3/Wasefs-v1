import { hostname } from "node:os";

import { type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";

import type { ApiEnv } from "../config/env.js";
import type { PinoLogger } from "nestjs-pino";

const BLOCK_MS = 2_000;
/** Entries a crashed consumer left unacknowledged are taken over after this long. */
const CLAIM_IDLE_MS = 60_000;

type StreamBatch = [string, [string, string[]][]][] | null;

/**
 * A Redis stream consumer group reader, the shape of the OTP `InboundConsumer`: one blocking
 * connection of its own, stale entries claimed after a minute, every entry acknowledged whatever
 * happens (a malformed one would be redelivered for ever, and a retry could answer twice). Any number
 * of api replicas can run; each entry goes to one of them.
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
  ) {}

  /** Handles one parsed JSON payload (null when the entry was not JSON). Throwing is logged, not retried. */
  abstract process(payload: unknown): Promise<void>;

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
        if (Date.now() - lastClaim > CLAIM_IDLE_MS) {
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
    try {
      const index = fields.indexOf("data");
      let payload: unknown = null;
      try {
        payload = index >= 0 ? JSON.parse(fields[index + 1] ?? "null") : null;
      } catch {
        payload = null;
      }
      await this.process(payload);
    } catch (error) {
      this.logger.error({ reason: (error as Error).name }, "Handling stream entry failed");
    }
    await connection.xack(this.stream, this.group, id);
  }
}
