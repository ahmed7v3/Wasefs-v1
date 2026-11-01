import { Inject, Injectable } from "@nestjs/common";
import { ErrorCode, isAppError } from "@wasfa/shared/errors";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { WA_AGENT_RX_TTL_SECONDS, waAgentRxKey } from "@wasfa/shared/schemas/wa-agent";
import { uuidFromKey } from "@wasfa/shared/wa-agent/uuid-from-key";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { CreditsService } from "../../credits/credits.service.js";
import { FilesService } from "../../files/files.service.js";
import { PlansService } from "../../plans/plans.service.js";
import { RxService, type PreparedRx, type RxCacheHit } from "../../rx/rx.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { StaleFenceError } from "../agent/tools/tool.js";

import {
  RxAlreadyAnalysedError,
  WaAgentCommerceRepo,
  type InboundMedia,
} from "./agent-commerce.repo.js";
import { agentUser } from "./agent-user.js";
import { usageReason } from "./usage-errors.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { FileViewer } from "../../files/files.repo.js";
import type { AgentCall, AgentToolResult, ToolEffectInfo } from "../agent/tools/tool.js";
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
    if (call.effect !== undefined) {
      return this.analyzeOnce(call, call.effect, {
        user,
        creditsPerPage: rxSettings.creditsPerPage,
        maxPages,
      });
    }
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
          await this.discard(viewer, fileIds);
          return declined("unreadable_image");
        }
        if (status !== "processed") {
          await giveBack();
          await this.discard(viewer, fileIds);
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
      // Imported pages nobody references would stay for ever; one an analysis uses is kept.
      await this.discard(viewer, fileIds);
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

  /** Removes the imported pages of a start that did not happen; a failure here must not hide the real reason. */
  private async discard(viewer: FileViewer, fileIds: readonly string[]): Promise<void> {
    for (const fileId of fileIds) {
      try {
        await this.files.discardImported(viewer, fileId);
      } catch (error) {
        this.logger.warn(
          { reason: error instanceof Error ? error.name : "unknown" },
          "Imported prescription page could not be discarded",
        );
      }
    }
  }

  /**
   * The start of a v2 turn (docs/WA-AGENT-RUNTIME.md section 17.3): import (reusing the file an earlier
   * try already made), the existing credit hold under a key derived from the tool call, then one
   * transaction for the claim, the analysis and the outbox route. The queue job is added after the
   * commit; if that fails the reconciler adds it, and the analysis stays started.
   */
  private async analyzeOnce(
    call: AgentCall,
    effect: ToolEffectInfo,
    base: { user: AuthenticatedUser; creditsPerPage: number; maxPages: number },
  ): Promise<AgentToolResult> {
    const { user, creditsPerPage, maxPages } = base;
    const newest = await this.commerce.newestUnusedMedia(
      call.conversationId,
      ["image"],
      new Date(call.now.getTime() - IMAGE_WINDOW_MS),
      "rxId",
      maxPages,
    );
    if (newest.length === 0) return declined("no_image");
    const images = [...newest].reverse();
    const mediaIds = images.map((image) => image.id);
    const viewer = { id: call.userId, orgIds: [] };

    // Slow and idempotent, outside any transaction: the file of a picture is kept on its row.
    const fileIds: string[] = [];
    for (const image of images) {
      let fileId = image.fileId;
      if (fileId === null) {
        fileId = await this.files.importObject(viewer, {
          sourceKey: image.mediaKey,
          purpose: "rx_page",
          mime: image.mediaMime as (typeof WA_AGENT_IMAGE_MIMES)[number],
          bytes: image.mediaBytes,
        });
        await this.commerce.setMediaMeta(image.id, { fileId });
      }
      fileIds.push(fileId);
    }
    const discardAll = async () => {
      await this.discard(viewer, fileIds);
      await this.commerce.dropMediaFileId(mediaIds);
    };
    for (const fileId of fileIds) {
      let status;
      try {
        status = await this.files.awaitProcessed(viewer, fileId, {
          timeoutMs: PROCESSING_WAIT_MS,
          pollMs: PROCESSING_POLL_MS,
        });
      } catch (error) {
        if (!isAppError(error) || error.code !== ErrorCode.NOT_FOUND) throw error;
        // The file kept on the row is gone: forget it so the next try imports the picture again.
        await this.commerce.dropMediaFileId(mediaIds);
        return declined("still_processing");
      }
      if (status === "rejected") {
        await discardAll();
        return declined("unreadable_image");
      }
      if (status !== "processed") {
        await discardAll();
        return declined("still_processing");
      }
    }

    const id = uuidFromKey(effect.key);
    const started = {
      started: true,
      pages: fileIds.length,
      credits: fileIds.length * creditsPerPage,
      etaSeconds: ETA_SECONDS,
    };
    let ready: PreparedRx | undefined;
    let committed: { hit: RxCacheHit | null; reservationId: string | null } | undefined;
    try {
      const prepared = await this.rx.prepare(user, { fileIds, mode: "balanced" });
      ready = prepared;
      const cacheHit = await this.rx.cacheHit(prepared);
      const held = await this.rx.reserveFor(prepared, id, cacheHit);
      await this.commerce.commitRxStart({
        effectKey: effect.key,
        turnId: effect.turnId,
        conversationId: call.conversationId,
        fence: effect.fence,
        mediaIds,
        analysisId: id,
        result: started,
        create: (tx) =>
          this.rx.createInTx(tx, prepared, { id, reservationId: held, hit: cacheHit }),
      });
      committed = { hit: cacheHit, reservationId: held };
    } catch (error) {
      await ready?.ticket.release();
      // Nothing was written. A turn that lost the chat just stops; its credit hold expires on its own.
      if (error instanceof StaleFenceError) throw error;
      if (error instanceof RxAlreadyAnalysedError) {
        await discardAll();
        return declined("already_analysed");
      }
      const reason = usageReason(error);
      if (reason === null || !isAppError(error)) throw error;
      await discardAll();
      if (reason === "insufficient_credits") {
        const wallet = await this.credits.forUser(call.userId, call.now);
        return declined(reason, { balance: wallet.wallet.balance, costPerPage: creditsPerPage });
      }
      return declined(reason);
    }

    // Committed: whatever fails from here on, the analysis and its route exist.
    await this.redis
      .set(waAgentRxKey(id), call.conversationId, "EX", WA_AGENT_RX_TTL_SECONDS)
      .catch(() => undefined);
    try {
      if (ready === undefined || committed === undefined)
        throw new Error("committed start missing");
      const { hit, reservationId } = committed;
      // A cached result has no worker event: the outbox sweep delivers it once the analysis is `done`.
      if (hit !== null) await this.rx.settleCacheHit(ready, { id, reservationId, hit });
      else await this.rx.enqueue(id, ready);
    } catch (error) {
      this.logger.error(
        { rxId: id, reason: error instanceof Error ? error.name : "unknown" },
        "Agent prescription job not queued; the reconciler retries",
      );
    }
    this.logger.info(
      { conversationId: call.conversationId, rxId: id, pages: fileIds.length },
      "Agent prescription reading started",
    );
    return started;
  }
}
