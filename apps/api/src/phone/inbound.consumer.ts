import { hostname } from "node:os";

import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { WA_INBOUND_STREAM, inboundMessageSchema } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { API_ENV } from "../config/config.module.js";

import { WhatsAppInboundVerifier } from "./phone-verifier.js";
import { PHONE_VERIFIER } from "./phone.tokens.js";

import type { ApiEnv } from "../config/env.js";

const GROUP = "api";
const BLOCK_MS = 2_000;
/** Entries a crashed consumer left unacknowledged are taken over after this long. */
const CLAIM_IDLE_MS = 60_000;

type StreamBatch = [string, [string, string[]][]][] | null;

/**
 * Reads `wa:inbound` (written by the WhatsApp bridge) in the consumer group `api` and resolves
 * verification challenges. Any number of api replicas can run: each entry goes to one of them, and
 * the single-use code makes a re-delivered entry harmless. Only started when a WhatsApp number is
 * configured.
 */
@Injectable()
export class InboundConsumer implements OnModuleInit, OnApplicationShutdown {
  private connection: Redis | undefined;
  private loop: Promise<void> | undefined;
  private stopped = false;
  private readonly consumerName = `${hostname()}-${process.pid}`;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(PHONE_VERIFIER) private readonly verifier: WhatsAppInboundVerifier,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("PhoneInbound");
  }

  async onModuleInit(): Promise<void> {
    if (this.env.WHATSAPP_NUMBER === undefined) return;
    // A blocking read needs its own connection, without the shared one's command timeout.
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on("error", (error: Error) => {
      this.logger.error({ reason: error.message }, "Inbound stream connection error");
    });
    try {
      await this.connection.xgroup("CREATE", WA_INBOUND_STREAM, GROUP, "$", "MKSTREAM");
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
          GROUP,
          this.consumerName,
          "COUNT",
          20,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          WA_INBOUND_STREAM,
          ">",
        )) as StreamBatch;
        for (const [, entries] of batch ?? []) {
          for (const [id, fields] of entries) await this.handle(connection, id, fields);
        }
      } catch (error) {
        if (this.stopped) return;
        this.logger.error({ reason: (error as Error).message }, "Inbound stream read failed");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  private async claimStale(connection: Redis): Promise<void> {
    const claimed = (await connection.xautoclaim(
      WA_INBOUND_STREAM,
      GROUP,
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

  /** Always acknowledged: a malformed entry would otherwise be redelivered forever. */
  private async handle(connection: Redis, id: string, fields: string[]): Promise<void> {
    try {
      const index = fields.indexOf("data");
      const parsed = inboundMessageSchema.safeParse(
        index >= 0 ? JSON.parse(fields[index + 1] ?? "null") : null,
      );
      if (!parsed.success) {
        this.logger.warn("Malformed inbound entry dropped");
      } else {
        const result = await this.verifier.handleInbound(parsed.data);
        if (result.outcome === "verified") {
          await this.verifier.requestReply(parsed.data, "verified");
        } else if (!(await this.verifier.isSilenced(parsed.data.phone))) {
          await this.verifier.requestReply(parsed.data, "invalid");
        }
      }
    } catch (error) {
      // Not retried: a retry could answer twice, and the user can simply start again.
      this.logger.error({ reason: (error as Error).message }, "Handling inbound entry failed");
    }
    await connection.xack(WA_INBOUND_STREAM, GROUP, id);
  }
}
