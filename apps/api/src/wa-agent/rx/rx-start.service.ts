import { Inject, Injectable } from "@nestjs/common";
import { ErrorCode, isAppError } from "@wasfa/shared/errors";
import { WA_AGENT_RX_TTL_SECONDS, waAgentRxKey } from "@wasfa/shared/schemas/wa-agent";
import { uuidFromKey } from "@wasfa/shared/wa-agent/uuid-from-key";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { CreditsService } from "../../credits/credits.service.js";
import { FilesService } from "../../files/files.service.js";
import { RxService, type PreparedRx, type RxCacheHit } from "../../rx/rx.service.js";
import { StaleFenceError } from "../agent/tools/tool.js";
import { usageReason } from "../commerce/usage-errors.js";

import { AgentRxRepo, RxAlreadyAnalysedError } from "./agent-rx.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { FileViewer } from "../../files/files.repo.js";
import type { AgentCall, AgentToolResult, ToolEffectInfo } from "../agent/tools/tool.js";
import type { WA_AGENT_IMAGE_MIMES } from "@wasfa/shared/schemas/wa-agent";

/** Pictures older than this are not "the prescription the customer just sent". */
export const IMAGE_WINDOW_MS = 15 * 60 * 1_000;
export const PROCESSING_WAIT_MS = 30_000;
export const PROCESSING_POLL_MS = 1_000;
/** What the agent may tell the customer about the wait. */
export const ETA_SECONDS = 60;

export const declined = (reason: string, extra: AgentToolResult = {}): AgentToolResult => ({
  started: false,
  reason,
  ...extra,
});

/** The v2 start of `analyze_prescription` (docs/WA-AGENT-RUNTIME.md section 17.3). */
@Injectable()
export class RxStartService {
  constructor(
    private readonly rxRepo: AgentRxRepo,
    private readonly files: FilesService,
    private readonly rx: RxService,
    private readonly credits: CreditsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentRx");
  }

  /** Removes the imported pages of a start that did not happen; a failure here must not hide the real reason. */
  async discard(viewer: FileViewer, fileIds: readonly string[]): Promise<void> {
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
  async analyzeOnce(
    call: AgentCall,
    effect: ToolEffectInfo,
    base: { user: AuthenticatedUser; creditsPerPage: number; maxPages: number },
  ): Promise<AgentToolResult> {
    const { user, creditsPerPage, maxPages } = base;
    const newest = await this.rxRepo.newestUnusedMedia(
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
        await this.rxRepo.setMediaMeta(image.id, { fileId });
      }
      fileIds.push(fileId);
    }
    const discardAll = async () => {
      await this.discard(viewer, fileIds);
      await this.rxRepo.dropMediaFileId(mediaIds);
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
        await this.rxRepo.dropMediaFileId(mediaIds);
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
      await this.rxRepo.commitRxStart({
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
