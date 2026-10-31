import { Inject, Injectable } from "@nestjs/common";
import { isAppError } from "@wasfa/shared/errors";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { WA_AGENT_RX_TTL_SECONDS, waAgentRxKey } from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { CreditsService } from "../../credits/credits.service.js";
import { FilesService } from "../../files/files.service.js";
import { PlansService } from "../../plans/plans.service.js";
import { RxService } from "../../rx/rx.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentCommerceRepo } from "../commerce/agent-commerce.repo.js";
import { agentUser } from "../commerce/agent-user.js";
import { usageReason } from "../commerce/usage-errors.js";

import { AgentRxRepo, type InboundMedia } from "./agent-rx.repo.js";
import {
  ETA_SECONDS,
  IMAGE_WINDOW_MS,
  PROCESSING_POLL_MS,
  PROCESSING_WAIT_MS,
  RxStartService,
  declined,
} from "./rx-start.service.js";

import type { AgentCall, AgentToolResult } from "../agent/tools/tool.js";
import type { WA_AGENT_IMAGE_MIMES } from "@wasfa/shared/schemas/wa-agent";

/**
 * `analyze_prescription`: the customer's recent pictures become `rx_page` files of their own and go
 * through `RxService.create`, the same entry as the web: credit hold, quota, kill switch, page
 * limits. The answer arrives later as an event (`WaAgentEventsConsumer`).
 */
@Injectable()
export class AgentRxService {
  constructor(
    private readonly commerce: WaAgentCommerceRepo,
    private readonly rxRepo: AgentRxRepo,
    private readonly start: RxStartService,
    private readonly files: FilesService,
    private readonly rx: RxService,
    private readonly plans: PlansService,
    private readonly credits: CreditsService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentRx");
  }

  async analyze(call: AgentCall): Promise<AgentToolResult> {
    const row = await this.commerce.user(call.userId);
    if (row?.status !== "active") return declined("account_unavailable");
    const user = agentUser(row, call.now);

    const [rxSettings, entitlement] = await Promise.all([
      this.settings.get("rx"),
      this.plans.entitlement({ type: "user", id: call.userId }, "rx_extract"),
    ]);
    const maxPages = Math.min(
      RX_MAX_PAGES,
      rxSettings.maxPages,
      entitlement?.maxPagesPerRx ?? RX_MAX_PAGES,
    );
    if (call.effect !== undefined) {
      return this.start.analyzeOnce(call, call.effect, {
        user,
        creditsPerPage: rxSettings.creditsPerPage,
        maxPages,
      });
    }
    // Newest first from the database; pages are read in the order the customer sent them.
    const newest = await this.rxRepo.newestUnusedMedia(
      call.conversationId,
      ["image"],
      new Date(call.now.getTime() - IMAGE_WINDOW_MS),
      "rxId",
      maxPages,
    );
    if (newest.length === 0) return declined("no_image");
    const images = [...newest].reverse();

    // First claim wins, so two quick calls cannot read the same picture twice.
    const claimed: InboundMedia[] = [];
    for (const image of images) {
      if (await this.commerce.claimMedia(image.id, "rxId")) claimed.push(image);
    }
    if (claimed.length === 0) return declined("no_image");
    const giveBack = async () => {
      for (const image of claimed) await this.rxRepo.releaseMedia(image.id, "rxId");
    };

    const viewer = { id: call.userId, orgIds: [] };
    const fileIds: string[] = [];
    try {
      for (const image of claimed) {
        fileIds.push(
          await this.files.importObject(viewer, {
            sourceKey: image.mediaKey,
            purpose: "rx_page",
            mime: image.mediaMime as (typeof WA_AGENT_IMAGE_MIMES)[number],
            bytes: image.mediaBytes,
          }),
        );
      }
      for (const fileId of fileIds) {
        const status = await this.files.awaitProcessed(viewer, fileId, {
          timeoutMs: PROCESSING_WAIT_MS,
          pollMs: PROCESSING_POLL_MS,
        });
        if (status === "rejected") {
          await giveBack();
          await this.start.discard(viewer, fileIds);
          return declined("unreadable_image");
        }
        if (status !== "processed") {
          await giveBack();
          await this.start.discard(viewer, fileIds);
          return declined("still_processing");
        }
      }
      const created = await this.rx.create(user, { fileIds, mode: "balanced" });
      for (const image of claimed) {
        await this.rxRepo.setMediaMeta(image.id, { rxId: created.id });
      }
      await this.redis.set(
        waAgentRxKey(created.id),
        call.conversationId,
        "EX",
        WA_AGENT_RX_TTL_SECONDS,
      );
      this.logger.info(
        { conversationId: call.conversationId, rxId: created.id, pages: fileIds.length },
        "Agent prescription reading started",
      );
      return {
        started: true,
        pages: fileIds.length,
        credits: fileIds.length * rxSettings.creditsPerPage,
        etaSeconds: ETA_SECONDS,
      };
    } catch (error) {
      await giveBack();
      // Imported pages nobody references would stay for ever; one an analysis uses is kept.
      await this.start.discard(viewer, fileIds);
      const reason = usageReason(error);
      if (reason === null || !isAppError(error)) throw error;
      if (reason === "insufficient_credits") {
        const wallet = await this.credits.forUser(call.userId, call.now);
        return declined(reason, {
          balance: wallet.wallet.balance,
          costPerPage: rxSettings.creditsPerPage,
        });
      }
      return declined(reason);
    }
  }
}
