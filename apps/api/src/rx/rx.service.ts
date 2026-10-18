import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { skillVersion } from "@wasfa/ai";
import { type FileRecord, type RxAnalysis } from "@wasfa/db";
import { classifyMatch } from "@wasfa/shared/drugs";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { newErrorRef, newId } from "@wasfa/shared/ids";
import { parseStrength } from "@wasfa/shared/normalize";
import { redactText } from "@wasfa/shared/redact";
import { RX_MAX_PAGES, RX_SKILL_NAME } from "@wasfa/shared/rx";
import {
  RX_FREE_CACHE_HOURS,
  RX_NEAR_DUPLICATE_DAYS,
  RX_NEAR_DUPLICATE_MAX_DISTANCE,
  rxChannel,
  rxEventSchema,
  rxLastEventKey,
  rxResultSchema,
  rxSeqKey,
  type RxCandidatesResponse,
  type RxCorrectionRequest,
  type RxCreateRequest,
  type RxCreateResponse,
  type RxEvent,
  type RxListQuery,
  type RxListResponse,
  type RxRatingRequest,
  type RxRatingResponse,
  type RxResult,
  type RxView,
} from "@wasfa/shared/schemas/rx";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { decodeCursor, toPage } from "../admin/common/keyset.js";
import { AiRuntimeService } from "../ai-runtime/ai-runtime.service.js";
import { REDIS } from "../common/redis.js";
import { CreditsService } from "../credits/credits.service.js";
import { DrugMatcher } from "../drugs/matcher.js";
import { FilesRepo } from "../files/files.repo.js";
import { PayerService, type PayerContext } from "../orgs/wallet/payer.service.js";
import { PlansService } from "../plans/plans.service.js";
import { QuotaService } from "../quota/quota.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { applyCorrection, type PickedDrug } from "./rx-correction.js";
import { RxEventHub } from "./rx-event-hub.js";
import { RxQueue } from "./rx-queue.js";
import { IN_FLIGHT, RxRepo } from "./rx.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";
import type { QuotaTicket } from "../quota/quota.service.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NAMES_IN_LIST = 3;

const invalid = (details: Record<string, string | number>): AppError =>
  new AppError(ErrorCode.VALIDATION_FAILED, { httpStatus: 422, details });

/** The processed pages of a request, in the order the user gave them. */
interface Page {
  fileId: string;
  sha256: string;
  dhash: string | null;
}

/** A taste of Deep mode (Task 3.14): the paid plan whose Deep reading the free user tries once. */
export interface RxTasteOptions {
  routePlanId: string;
}

interface Started {
  user: AuthenticatedUser;
  payer: PayerContext;
  /** Set for a taste: the job is routed by this plan. */
  routePlanId?: string | undefined;
  input: RxCreateRequest;
  pages: Page[];
  routeVersion: number;
  creditsPerPage: number;
  ticket: QuotaTicket;
}

const isInFlight = (status: RxAnalysis["status"]): boolean =>
  (IN_FLIGHT as readonly string[]).includes(status);

/**
 * Prescription analysis (Task 2.8). `POST /rx` checks, in order: kill switch, ownership and state of
 * the files, the page limit, the plan and daily quota, the exact-match cache, then reserves the
 * credits and queues the worker job. The worker reads, matches, verifies and settles; this service
 * serves the result, its live progress, the history and the user's corrections.
 *
 * Analyses belong to the user who made them. With `orgId` the organization's plan and quota apply and
 * its wallet pays first (`PayerService`); every read goes through the owner-scoped repository.
 */
@Injectable()
export class RxService {
  constructor(
    private readonly repo: RxRepo,
    private readonly files: FilesRepo,
    private readonly queue: RxQueue,
    private readonly ai: AiRuntimeService,
    private readonly plans: PlansService,
    private readonly quota: QuotaService,
    private readonly credits: CreditsService,
    private readonly payer: PayerService,
    private readonly settings: SettingsService,
    private readonly matcher: DrugMatcher,
    private readonly hub: RxEventHub,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("Rx");
  }

  async create(
    user: AuthenticatedUser,
    input: RxCreateRequest,
    taste?: RxTasteOptions,
  ): Promise<RxCreateResponse> {
    // The kill switch (and the daily spend cap) come before anything else is looked at.
    await this.ai.assertAvailable("rx_extract", { search: false });

    // An organization context needs an active membership; its plan and quota then apply.
    const payer = await this.payer.resolve(user.id, input.orgId);
    const owner = payer.planOwner;
    const pages = await this.loadPages(user, input.fileIds);
    const [rx, plan, entitlement] = await Promise.all([
      this.settings.get("rx"),
      this.plans.effectivePlan(owner),
      this.plans.entitlement(owner, "rx_extract"),
    ]);
    const maxPages = Math.min(
      RX_MAX_PAGES,
      rx.maxPages,
      entitlement?.maxPagesPerRx ?? RX_MAX_PAGES,
    );
    if (pages.length > maxPages) throw invalid({ reason: "too_many_pages", maxPages });

    // A taste reads with the Deep route of the plan that sells it; everything else with the owner's.
    const route = await this.ai.route("rx_extract", taste?.routePlanId ?? plan.id, input.mode);
    if (route === null) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason: "no_route" } });
    }
    const ticket = await this.quota.check({
      ...this.payer.quotaOwner(payer),
      userId: user.id,
      task: "rx_extract",
      mode: input.mode,
      ...(taste ? { modeGranted: true } : {}),
    });
    try {
      return await this.start({
        user,
        payer,
        routePlanId: taste?.routePlanId,
        input,
        pages,
        routeVersion: route.version,
        creditsPerPage: rx.creditsPerPage,
        ticket,
      });
    } catch (error) {
      await ticket.release();
      throw error;
    }
  }

  async get(user: AuthenticatedUser, id: string): Promise<RxView> {
    return this.view(await this.repo.require(user.id, id));
  }

  /**
   * The customer view of an analysis the caller already proved they may read. The admin viewer
   * (Task 3.15, after a PHI access session) uses this very mapper, so staff see what the customer sees.
   */
  async view(row: RxAnalysis): Promise<RxView> {
    const pages = await this.repo.pages(row.id);
    return {
      id: row.id,
      status: row.status,
      mode: row.mode,
      result: this.resultOf(row),
      creditsCharged: row.creditsCharged,
      cached: row.cacheOf !== null,
      createdAt: row.createdAt.toISOString(),
      queuedAt: row.queuedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      errorRef: row.errorRef,
      rating: row.rating,
      shareForReview: row.shareForReview,
      files: pages.map((page) => ({
        fileId: page.fileId,
        pageNo: page.pageNo,
        imageDeleted: page.fileStatus === "deleted",
      })),
    };
  }

  /**
   * "Excellent" or "needs improving", with an optional note. Sharing is a separate, explicit choice
   * (off unless the person ticked it): only then can an admin see the picture and the reading. The
   * note is scrubbed of emails, phones and tokens before it is stored.
   */
  async rate(
    user: AuthenticatedUser,
    id: string,
    input: RxRatingRequest,
  ): Promise<RxRatingResponse> {
    const row = await this.repo.require(user.id, id);
    if (row.status !== "done") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_ready" } });
    }
    const note = input.note === undefined || input.note === "" ? null : redactText(input.note);
    const saved = await this.repo.setRating(user.id, id, {
      rating: input.rating,
      note,
      shareForReview: input.shareForReview,
    });
    if (!saved) throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_ready" } });
    return { rating: input.rating, shareForReview: input.shareForReview };
  }

  async list(user: AuthenticatedUser, query: RxListQuery): Promise<RxListResponse> {
    // Decoded first so a malformed cursor is refused whatever the user owns.
    const cursor = decodeCursor(query.cursor, "uuid");
    const rows = await this.repo.list(user.id, { cursor, limit: query.limit, q: query.q });
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      items: page.items.map((row) => {
        const parsed = rxResultSchema.safeParse(row.result);
        const items = parsed.success ? parsed.data.items : [];
        return {
          id: row.id,
          status: row.status,
          mode: row.mode,
          createdAt: row.createdAt.toISOString(),
          itemCount: items.length,
          itemNames: items
            .map((item) => item.name ?? item.rawText)
            .filter((name) => name.trim() !== "")
            .slice(0, NAMES_IN_LIST),
          pageCount: row.pageCount,
          creditsCharged: row.creditsCharged,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** Hard delete (DATABASE.md retention: until the owner deletes it). A running analysis cannot be deleted. */
  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.repo.require(user.id, id);
    if (isInFlight(row.status)) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "in_flight" } });
    }
    await this.repo.remove(user.id, id);
    await this.redis.del(rxSeqKey(id), rxLastEventKey(id)).catch(() => undefined);
  }

  /**
   * Starts the live feed of one analysis. `emit` receives the current state first, then every later
   * event; the caller closes the stream after a `done` or `failed` event. Returns the unsubscribe
   * function. Someone else's analysis is `NOT_FOUND` before anything is subscribed.
   */
  async openEvents(
    user: AuthenticatedUser,
    id: string,
    emit: (event: RxEvent) => void,
  ): Promise<() => void> {
    await this.repo.require(user.id, id);
    // Subscribed before the state is read, so nothing published in between is lost.
    let floor = -1;
    let live = false;
    const buffered: RxEvent[] = [];
    const stop = await this.hub.listen(rxChannel(id), (message) => {
      const event = parseEvent(message);
      if (event === null) return;
      if (!live) buffered.push(event);
      else if (event.seq > floor) emit(event);
    });
    try {
      const row = await this.repo.require(user.id, id);
      const initial = await this.currentEvent(row);
      floor = initial.seq;
      emit(initial);
      live = true;
      for (const event of buffered) if (event.seq > floor) emit(event);
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  }

  async correct(
    user: AuthenticatedUser,
    id: string,
    input: RxCorrectionRequest,
  ): Promise<{ result: RxResult }> {
    await this.repo.require(user.id, id);
    let drug: PickedDrug | null = null;
    if (input.field === "drug" && z.uuid().safeParse(input.after).success) {
      drug = await this.repo.drugWithIngredients(input.after);
      if (drug === null)
        throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["after"] } });
    }
    const result = await this.repo.applyCorrection(
      user.id,
      id,
      {
        itemIndex: input.itemIndex,
        field: input.field,
        after: input.after,
        consentForEval: input.consentForEval,
      },
      (current) =>
        applyCorrection(
          current,
          { itemIndex: input.itemIndex, field: input.field, after: input.after },
          drug,
        ),
    );
    return { result };
  }

  /** The five best drugs for one line, so the user can pick the right one. */
  async candidates(
    user: AuthenticatedUser,
    id: string,
    itemIndex: number,
  ): Promise<RxCandidatesResponse> {
    const row = await this.repo.require(user.id, id);
    const result = this.resultOf(row);
    if (result === null) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_ready" } });
    }
    const item = result.items[itemIndex];
    if (item === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const text = (item.name ?? "").trim() !== "" ? (item.name ?? "") : item.rawText;
    if (text.trim() === "") return { candidates: [] };
    const found = await this.matcher.matchDrug(text, {
      strength: item.strength === null ? null : parseStrength(item.strength),
      form: item.form,
    });
    return {
      candidates: found.map((candidate) => ({
        drugId: candidate.drugId,
        brandEn: candidate.brandEn,
        brandAr: candidate.brandAr,
        form: candidate.form,
        strengthText: candidate.strengthText,
        manufacturer: candidate.manufacturer,
        status: candidate.status,
        score: candidate.score,
        matchClass: classifyMatch(candidate),
      })),
    };
  }

  /** Owned and processed files, in the user's order. Anything else is `NOT_FOUND` or a 422. */
  private async loadPages(user: AuthenticatedUser, fileIds: readonly string[]): Promise<Page[]> {
    if (new Set(fileIds).size !== fileIds.length) throw invalid({ reason: "duplicate_file" });
    const viewer = { id: user.id, orgIds: [] };
    const found: FileRecord[] = [];
    for (const fileId of fileIds) {
      const file = await this.files.findFor(viewer, fileId);
      // A file of an organization is not the user's own page; it looks like no file at all.
      if (file === null || file.ownerUserId !== user.id) throw new AppError(ErrorCode.NOT_FOUND);
      found.push(file);
    }
    return found.map((file) => {
      if (file.purpose !== "rx_page") throw invalid({ reason: "file_purpose" });
      if (file.status !== "processed" || file.sha256 === null) {
        throw invalid({ reason: "file_not_processed" });
      }
      return { fileId: file.id, sha256: file.sha256, dhash: file.dhash };
    });
  }

  private async start(args: Started): Promise<RxCreateResponse> {
    const { user, input, pages } = args;
    const id = newId();
    const skill = skillVersion(RX_SKILL_NAME);
    const inputSha256 = createHash("sha256")
      .update(pages.map((page) => page.sha256).join(""))
      .digest("hex");

    const cached = await this.repo.findCached(user.id, {
      inputSha256,
      skillVersion: skill,
      routeVersion: args.routeVersion,
      mode: input.mode,
    });
    const copy = cached === null ? null : rxResultSchema.safeParse(cached.result);
    if (cached !== null && copy?.success) {
      await this.fromCache({ ...args, id, skill, inputSha256, cached, result: copy.data });
      return { id, nearDuplicate: null };
    }

    const nearDuplicate = await this.repo.findNearDuplicate(
      user.id,
      pages.flatMap((page) => (page.dhash === null ? [] : [page.dhash])),
      new Date(Date.now() - RX_NEAR_DUPLICATE_DAYS * DAY_MS),
      RX_NEAR_DUPLICATE_MAX_DISTANCE,
    );

    const reservationId = await this.reserve(args.payer, id, pages.length * args.creditsPerPage);
    try {
      await this.repo.insert(
        {
          id,
          ownerUserId: user.id,
          createdBy: user.id,
          status: "queued",
          mode: input.mode,
          reservationId,
          skillVersion: skill,
          inputSha256,
        },
        pages.map((page) => page.fileId),
      );
    } catch (error) {
      await this.releaseQuietly(reservationId, "rx_insert_failed");
      throw error;
    }
    try {
      await this.queue.analyze(id, {
        planOrgId: args.payer.orgId ?? undefined,
        routePlanId: args.routePlanId,
      });
    } catch (error) {
      // Nothing will ever pick it up: end it here, give the credits back, free the user.
      const errorRef = newErrorRef();
      this.logger.error({ analysisId: id, errorRef }, "rx job could not be queued");
      await this.repo.markFailed(id, errorRef);
      await this.releaseQuietly(reservationId, "rx_enqueue_failed");
      throw error;
    }
    return {
      id,
      nearDuplicate:
        nearDuplicate === null
          ? null
          : { analysisId: nearDuplicate.id, createdAt: nearDuplicate.createdAt.toISOString() },
    };
  }

  /**
   * An identical earlier analysis answers: no provider call, no queue. The owner's own re-upload
   * within 24 hours is free; any other hit is billed at the normal price (Decision 7).
   */
  private async fromCache(
    args: Started & {
      id: string;
      skill: string;
      inputSha256: string;
      cached: RxAnalysis;
      result: RxResult;
    },
  ): Promise<void> {
    const { user, payer, input, pages, id, cached } = args;
    const now = new Date();
    const free =
      cached.ownerUserId === user.id &&
      cached.finishedAt !== null &&
      now.getTime() - cached.finishedAt.getTime() < RX_FREE_CACHE_HOURS * HOUR_MS;
    const amount = free ? 0 : pages.length * args.creditsPerPage;

    const reservationId = await this.reserve(payer, id, amount);
    try {
      const usageId = await this.repo.recordUsage({
        task: "rx_extract",
        routeVersion: args.routeVersion,
        modelId: null,
        providerId: null,
        modelKey: "cache",
        ownerUserId: user.id,
        ownerOrgId: null,
        userId: user.id,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        searchCount: 0,
        costUsdMicros: 0,
        creditsCharged: amount,
        latencyMs: 0,
        outcome: "cache_hit",
        cacheHit: true,
        requestId: id,
      });
      await this.repo.insert(
        {
          id,
          ownerUserId: user.id,
          createdBy: user.id,
          status: "done",
          mode: input.mode,
          creditsCharged: amount,
          reservationId,
          skillVersion: args.skill,
          routeVersion: args.routeVersion,
          inputSha256: args.inputSha256,
          cacheOf: cached.id,
          result: args.result,
          patientInitials: cached.patientInitials,
          prescriberInitials: cached.prescriberInitials,
          queuedAt: now,
          startedAt: now,
          finishedAt: now,
        },
        pages.map((page) => page.fileId),
      );
      if (reservationId !== null) {
        await this.credits.settle(reservationId, amount, { aiUsageId: usageId });
      }
    } catch (error) {
      await this.releaseQuietly(reservationId, "rx_cache_failed");
      throw error;
    } finally {
      // No job will run, so nobody else frees the user's lock.
      await args.ticket.release();
    }
  }

  /** Holds the price of the analysis; `QUOTA_EXCEEDED` (`insufficient_credits`) when the wallet is short. */
  private async reserve(
    payer: PayerContext,
    analysisId: string,
    amount: number,
  ): Promise<string | null> {
    if (amount <= 0) return null;
    const { reservation } = await this.payer.reserve(payer, amount, {
      idempotencyKey: `rx:${analysisId}:reserve`,
      purpose: "rx",
    });
    return reservation.id;
  }

  private async releaseQuietly(reservationId: string | null, reason: string): Promise<void> {
    if (reservationId === null) return;
    try {
      await this.credits.release(reservationId, reason);
    } catch (error) {
      // The expiry sweeper returns the hold; the original failure is what the caller sees.
      this.logger.error(
        { reservationId, reason: error instanceof Error ? error.name : "unknown" },
        "rx credits release failed",
      );
    }
  }

  /** The stored result, validated; a row that fails the schema is logged and shown without a result. */
  private resultOf(row: RxAnalysis): RxResult | null {
    if (row.result === null) return null;
    const parsed = rxResultSchema.safeParse(row.result);
    if (parsed.success) return parsed.data;
    this.logger.error({ analysisId: row.id }, "stored rx result does not match the schema");
    return null;
  }

  private async lastEvent(id: string): Promise<RxEvent | null> {
    try {
      const raw = await this.redis.get(rxLastEventKey(id));
      return raw === null ? null : parseEvent(raw);
    } catch {
      return null;
    }
  }

  /** What a client that connects now should see first. The database decides the end state. */
  private async currentEvent(row: RxAnalysis): Promise<RxEvent> {
    const last = await this.lastEvent(row.id);
    switch (row.status) {
      case "done":
      case "refunded":
        return { type: "done", status: row.status, seq: last?.seq ?? 0 };
      case "failed":
        return { type: "failed", errorRef: row.errorRef ?? "", seq: last?.seq ?? 0 };
      default:
        // Queued, or between events: the first step is the honest place to start from.
        return last?.type === "step" ? last : { type: "step", step: "read", seq: 0 };
    }
  }
}

function parseEvent(raw: string): RxEvent | null {
  try {
    const parsed = rxEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
