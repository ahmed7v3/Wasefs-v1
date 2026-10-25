import { Inject, Injectable } from "@nestjs/common";
import { signPreviewToken } from "@wasfa/shared/content/preview-token";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { ContentItemsRepo } from "./items.repo.js";

import type { ApiEnv } from "../config/env.js";

/**
 * Stateless draft-preview links (CONTENT-PLATFORM §4.4): an HMAC token over the item id and an
 * expiry, never stored. Without `CONTENT_PREVIEW_SECRET` previews are off and the route answers 404.
 */
@Injectable()
export class PreviewTokenService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly repo: ContentItemsRepo,
    private readonly settings: SettingsService,
  ) {}

  async create(itemId: string): Promise<{ url: string; expiresAt: string }> {
    const secret = this.env.CONTENT_PREVIEW_SECRET;
    if (secret === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if ((await this.repo.findItem(itemId)) === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const { previewTokenHours } = await this.settings.get("content");
    const expiresAt = new Date(Date.now() + previewTokenHours * 3_600_000);
    const token = signPreviewToken(secret, {
      itemId,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    });
    const origin = this.env.WEB_ORIGIN[0] ?? "";
    return { url: `${origin}/preview/${token}`, expiresAt: expiresAt.toISOString() };
  }
}
