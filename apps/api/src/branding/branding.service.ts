import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  BRANDING_ASSET_URL_FIELD,
  brandingAssetPath,
  type BrandingAsset,
  type BrandingAssetKey,
} from "@wasfa/shared/schemas/branding";

import { AuditService } from "../audit/audit.service.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { inspectAssetUpload } from "./branding-asset.js";
import { BrandingRepo } from "./branding.repo.js";

import type { ApiEnv } from "../config/env.js";
import type { FastifyRequest } from "fastify";

/**
 * Brand image uploads. The bytes go to `site_assets`, the versioned public URL to the `branding`
 * setting (through `SettingsService.set`, which audits `setting.update` and clears the caches), and
 * a `branding.asset_*` row records what changed: key, type, size and digest, never the bytes.
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly repo: BrandingRepo,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async upload(
    actorId: string,
    request: FastifyRequest,
    key: BrandingAssetKey,
    dataUrl: string,
  ): Promise<BrandingAsset> {
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

    const url = `${this.env.API_PUBLIC_URL}${brandingAssetPath(key, sha256)}`;
    await this.setBranding(actorId, request, key, url, asset.width, asset.height);

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
    };
  }

  async remove(actorId: string, request: FastifyRequest, key: BrandingAssetKey): Promise<void> {
    const before = await this.repo.findMeta(key);
    if (!before || !(await this.repo.remove(key))) throw new AppError(ErrorCode.NOT_FOUND);

    await this.setBranding(actorId, request, key, null, null, null);
    await this.audit.recordFor(request, {
      actorId,
      action: "branding.asset_delete",
      targetType: "branding_asset",
      targetId: key,
      before: this.describe(before),
    });
  }

  /** Points the setting at the new URL; the logo's pixel size travels with it so pages reserve its space. */
  private async setBranding(
    actorId: string,
    request: FastifyRequest,
    key: BrandingAssetKey,
    url: string | null,
    width: number | null,
    height: number | null,
  ): Promise<void> {
    const current = await this.settings.get("branding");
    await this.settings.set(
      "branding",
      {
        ...current,
        [BRANDING_ASSET_URL_FIELD[key]]: url,
        ...(key === "logo" ? { logoWidth: width, logoHeight: height } : {}),
      },
      { actorId, request },
    );
  }

  private describe(meta: { contentType: string; size: number; sha256: string }) {
    return { contentType: meta.contentType, size: meta.size, sha256: meta.sha256 };
  }
}
