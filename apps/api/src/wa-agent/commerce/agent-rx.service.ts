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

import { WaAgentCommerceRepo, type InboundMedia } from "./agent-commerce.repo.js";
import { agentUser } from "./agent-user.js";
import { usageReason } from "./usage-errors.js";

import type { AgentCall, AgentToolResult } from "../agent/tools/tool.js";
import type { WA_AGENT_IMAGE_MIMES } from "@wasfa/shared/schemas/wa-agent";

/** Pictures older than this are not "the prescription the customer just sent". */
const IMAGE_WINDOW_MS = 15 * 60 * 1_000;
const PROCESSING_WAIT_MS = 30_000;
const PROCESSING_POLL_MS = 1_000;
/** What the agent may tell the customer about the wait. */
const ETA_SECONDS = 60;

const declined = (reason: string, extra: AgentToolResult = {}): AgentToolResult => ({
  started: false,
  reason,
  ...extra,
});

/**
 * `analyze_prescription`: the customer's recent pictures become `rx_page` files of their own and go
 * through `RxService.create`, the same entry as the web: credit hold, quota, kill switch, page
 * limits. The answer arrives later as an event (`WaAgentEventsConsumer`).
 */
@Injectable()
export class AgentRxService {
  constructor(
    private readonly commerce: WaAgentCommerceRepo,
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
    // Newest first from the database; pages are read in the order the customer sent them.
    const newest = await this.commerce.newestUnusedMedia(
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
      for (const image of claimed) await this.commerce.releaseMedia(image.id, "rxId");
    };

    try {
      const viewer = { id: call.userId, orgIds: [] };
      const fileIds: string[] = [];
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
          return declined("unreadable_image");
        }
        if (status !== "processed") {
          await giveBack();
          return declined("still_processing");
        }
      }
      const created = await this.rx.create(user, { fileIds, mode: "balanced" });
      for (const image of claimed) {
        await this.commerce.setMediaMeta(image.id, { rxId: created.id });
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
