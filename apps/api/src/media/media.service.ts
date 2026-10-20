import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  MEDIA_UPLOAD_TTL_SECONDS,
  mediaStagingKey,
  type CreateMediaUploadInput,
  type ListMediaQuery,
  type MediaAsset,
  type MediaListResponse,
  type MediaUploadResponse,
  type PatchMediaInput,
} from "@wasfa/shared/schemas/media";

import { AuditService } from "../audit/audit.service.js";

import { MediaQueue } from "./media-queue.js";
import { MediaStorage } from "./media-storage.js";
import { MediaRepo } from "./media.repo.js";

import type { MediaAssetRecord } from "@wasfa/db";
import type { FastifyRequest } from "fastify";

export function toMediaAsset(row: MediaAssetRecord): MediaAsset {
  return {
    id: row.id,
    sha256: row.sha256,
    status: row.status,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    focalX: row.focalX,
    focalY: row.focalY,
    altAr: row.altAr,
    altEn: row.altEn,
    blurDataUrl: row.blurDataUrl,
    variants: row.variants,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fields of an asset worth keeping in the audit trail (never bytes or the data URL). */
const AUDIT_FIELDS = [
  "sha256",
  "status",
  "mime",
  "bytes",
  "altAr",
  "altEn",
  "focalX",
  "focalY",
] as const;

/**
 * Admin side of the public media library. The api never touches image bytes: it presigns the
 * staging upload, then queues the worker. Every write leaves a `media.*` audit row.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepo,
    private readonly storage: MediaStorage,
    private readonly queue: MediaQueue,
    private readonly audit: AuditService,
  ) {}

  /** Dedupe: an image that is already `ready` (or being processed) is returned without an upload. */
  async createUpload(
    actorId: string,
    request: FastifyRequest,
    input: CreateMediaUploadInput,
  ): Promise<MediaUploadResponse> {
    const originalKey = mediaStagingKey(randomUUID());
    // Presigning first answers 503 when the media bucket is not configured, before any row is written.
    const put = await this.storage.presignPut({
      key: originalKey,
      contentType: input.mime,
      bytes: input.bytes,
      sha256Hex: input.sha256,
      expiresIn: MEDIA_UPLOAD_TTL_SECONDS,
    });
    const staged = await this.repo.upsertStaged({
      sha256: input.sha256,
      mime: input.mime,
      bytes: input.bytes,
      originalKey,
      createdBy: actorId,
    });
    if (staged === undefined) {
      const existing = await this.repo.findBySha(input.sha256);
      if (existing === undefined) throw new AppError(ErrorCode.CONFLICT);
      return { asset: toMediaAsset(existing) };
    }

    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "media.create",
        targetType: "media_asset",
        targetId: staged.id,
        after: { sha256: staged.sha256, mime: input.mime, bytes: input.bytes },
      },
      { verbatim: true },
    );
    return {
      asset: toMediaAsset(staged),
      upload: { url: put.url, headers: put.headers, expiresInSeconds: MEDIA_UPLOAD_TTL_SECONDS },
    };
  }

  /** The browser says the PUT finished: check the object exists, then hand the asset to the worker. */
  async commit(actorId: string, request: FastifyRequest, id: string): Promise<MediaAsset> {
    const row = await this.repo.findById(id);
    if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if (row.status === "processing" || row.status === "ready") return toMediaAsset(row);
    if (row.status === "rejected" || row.originalKey === null) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_committable" } });
    }
    const stored = await this.storage.headBytes(row.originalKey);
    if (stored === null || stored !== row.bytes) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "upload_missing" } });
    }

    if (await this.repo.markProcessing(id)) {
      await this.queue.process(id);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "media.commit",
          targetType: "media_asset",
          targetId: id,
          before: { status: "staged" },
          after: { status: "processing" },
        },
        { verbatim: true },
      );
    }
    const fresh = await this.repo.findById(id);
    if (fresh === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    return toMediaAsset(fresh);
  }

  async get(id: string): Promise<MediaAsset> {
    const row = await this.repo.findById(id);
    if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    return toMediaAsset(row);
  }

  async list(query: ListMediaQuery): Promise<MediaListResponse> {
    const { items, total } = await this.repo.list(query);
    return {
      items: items.map(toMediaAsset),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async patch(
    actorId: string,
    request: FastifyRequest,
    id: string,
    patch: PatchMediaInput,
  ): Promise<MediaAsset> {
    const before = await this.repo.findById(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const after = await this.repo.update(id, patch);
    if (after === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "media.update",
        targetType: "media_asset",
        targetId: id,
        before,
        after,
      },
      { fields: AUDIT_FIELDS },
    );
    return toMediaAsset(after);
  }
}
