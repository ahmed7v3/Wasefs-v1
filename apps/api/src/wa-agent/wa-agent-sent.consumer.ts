import { Inject, Injectable } from "@nestjs/common";
import { WA_AGENT_SENT_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentSentSchema } from "@wasfa/shared/schemas/wa-agent";
import { PinoLogger } from "nestjs-pino";

import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { StreamConsumer } from "./stream-consumer.js";
import { WaAgentRepo } from "./wa-agent.repo.js";

import type { ApiEnv } from "../config/env.js";

const GROUP = "wa-agent";

/** Reads the bridge's verdicts on `wa:agent:sent` and records them on the queued rows. */
@Injectable()
export class WaAgentSentConsumer extends StreamConsumer {
  constructor(
    @Inject(API_ENV) env: ApiEnv,
    logger: PinoLogger,
    private readonly repo: WaAgentRepo,
    settings: SettingsService,
  ) {
    super(env, logger, WA_AGENT_SENT_STREAM, GROUP, {
      isV2: async () => (await settings.get("waAgent")).runtime.v2,
      keepData: true,
    });
    this.logger.setContext("WaAgentSent");
  }

  async process(payload: unknown): Promise<void> {
    const parsed = waAgentSentSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn("Malformed agent sent entry dropped");
      return;
    }
    const { messageId, status, reason, waMessageId } = parsed.data;
    // Idempotent under redelivery: only a still-queued row changes (`markOutbound`).
    await this.repo.recordVerdict(messageId, status, { reason, waMessageId });
  }
}
