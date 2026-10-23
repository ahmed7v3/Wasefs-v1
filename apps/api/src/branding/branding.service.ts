import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  brandingAssetPath,
  brandingAssetUrlField,
  type BrandingAsset,
  type BrandingAssetKey,
  type BrandingAssetList,
  type PutBrandingAssetResponse,
} from "@wasfa/shared/schemas/branding";

import { AuditService } from "../audit/audit.service.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { inspectAssetUpload } from "./branding-asset.js";
import { BrandingQueue } from "./branding-queue.js";
import { BrandingRepo, type AssetMeta } from "./branding.repo.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

/**
 * Brand image uploads. The bytes go to `site_assets` (the previous version to `site_asset_history`),
 * the versioned public URL of the keys that have a `branding` field to the setting (through
 * `SettingsService.set`, which audits `setting.update` and clears the caches), and a
 * `branding.asset_*` row records what changed: key, type, size and digest, never the bytes.
 * Uploading the `symbol` also queues the worker job that renders the icon set from it.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly repo: BrandingRepo,
    private readonly queue: BrandingQueue,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(): Promise<BrandingAssetList> {
    const [rows, history] = await Promise.all([this.repo.listMeta(), this.repo.historyCounts()]);
    return {
      items: rows.map((row) => ({ ...this.view(row), updatedAt: row.updatedAt.toISOString() })),
      history: Object.fromEntries(history),
    };
  }

  async upload(
    actorId: string,
    request: FastifyRequest,
    key: BrandingAssetKey,
    dataUrl: string,
  ): Promise<PutBrandingAssetResponse> {
    const asset = inspectAssetUpload(key, dataUrl);
    const sha256 = createHash("sha256").update(asset.data).digest("hex");
    const before = await this.repo.findMeta(key);

    await this.repo.upsert({
      key,
      contentType: asset.contentType,
      data: asset.data,
      sha256,
      width: asset.width,
      height: asset.height,
      updatedBy: actorId,
    });

    const url = this.urlOf(key, sha256);
    await this.setBranding(actorId, request, key, url, asset.width, asset.height);
    if (key === "symbol") await this.queue.icons(sha256);

    await this.audit.recordFor(request, {
      actorId,
      action: "branding.asset_upload",
      targetType: "branding_asset",
      targetId: key,
      before: before ? this.describe(before) : null,
      after: { contentType: asset.contentType, size: asset.data.length, sha256 },
    });
    return {
      key,
      contentType: asset.contentType,
      size: asset.data.length,
      sha256,
      width: asset.width,
      height: asset.height,
      url,
      warnings: asset.warnings,
      generating: key === "symbol",
    };
  }

  async remove(actorId: string, request: FastifyRequest, key: BrandingAssetKey): Promise<void> {
    const before = await this.repo.findMeta(key);
    if (!before || !(await this.repo.remove(key, actorId))) throw new AppError(ErrorCode.NOT_FOUND);

    await this.setBranding(actorId, request, key, null, null, null);
    await this.audit.recordFor(request, {
      actorId,
      action: "branding.asset_delete",
      targetType: "branding_asset",
      targetId: key,
      before: this.describe(before),
    });
  }

  /** Puts the newest archived version back live. `NOT_FOUND` when the key has none. */
  async revert(
    actorId: string,
    request: FastifyRequest,
    key: BrandingAssetKey,
  ): Promise<PutBrandingAssetResponse> {
    const before = await this.repo.findMeta(key);
    const restored = await this.repo.revert(key, actorId);
    if (!restored) throw new AppError(ErrorCode.NOT_FOUND);

    const url = this.urlOf(key, restored.sha256);
    await this.setBranding(actorId, request, key, url, restored.width, restored.height);
    // A symbol back means its icons are the ones to show again.
    if (key === "symbol") await this.queue.icons(restored.sha256);

    const size = restored.data.length;
    await this.audit.recordFor(request, {
      actorId,
      action: "branding.asset_revert",
      targetType: "branding_asset",
      targetId: key,
      before: before ? this.describe(before) : null,
      after: { contentType: restored.contentType, size, sha256: restored.sha256 },
    });
    return {
      key,
      contentType: restored.contentType,
      size,
      sha256: restored.sha256,
      width: restored.width,
      height: restored.height,
      url,
      warnings: [],
      generating: key === "symbol",
    };
  }

  private urlOf(key: BrandingAssetKey, sha256: string): string {
    return `${this.env.API_PUBLIC_URL}${brandingAssetPath(key, sha256)}`;
  }

  private view(row: AssetMeta): BrandingAsset {
    return {
      key: row.key,
      contentType: row.contentType,
      size: row.size,
      sha256: row.sha256,
      width: row.width,
      height: row.height,
      url: this.urlOf(row.key, row.sha256),
    };
  }

  /**
   * Points the setting at the new URL, for the keys that have a field there (the others are served
   * at `/assets/<key>` only); the logo's pixel size travels with it so pages reserve its space.
   */
  private async setBranding(
    actorId: string,
    request: FastifyRequest,
    key: BrandingAssetKey,
    url: string | null,
    width: number | null,
    height: number | null,
  ): Promise<void> {
    const field = brandingAssetUrlField(key);
    if (field === undefined) return;
    const current = await this.settings.get("branding");
    await this.settings.set(
      "branding",
      {
        ...current,
        [field]: url,
        ...(key === "logo" ? { logoWidth: width, logoHeight: height } : {}),
      },
      { actorId, request },
    );
  }

  private describe(meta: { contentType: string; size: number; sha256: string }) {
    return { contentType: meta.contentType, size: meta.size, sha256: meta.sha256 };
  }
}
