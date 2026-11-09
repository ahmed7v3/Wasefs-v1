import { Controller, Get } from "@nestjs/common";
import { localDayBounds } from "@wasfa/shared/content";
import { PUBLISHING_API_BASE } from "@wasfa/shared/publishing";

import { SettingsService } from "../settings/settings.service.js";

import { PublishingKeysRepo } from "./publishing-keys.repo.js";
import { CurrentKey, PublishingAuth, type PublishingPrincipal } from "./publishing-principal.js";

const CAIRO = "Africa/Cairo";

/** `GET /publishing/v1/me`: what this key is and what it may still do today. */
@Controller(`${PUBLISHING_API_BASE}/me`)
export class PublishingMeController {
  constructor(
    private readonly repo: PublishingKeysRepo,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @PublishingAuth()
  async me(@CurrentKey() key: PublishingPrincipal) {
    const now = new Date();
    const content = await this.settings.get("content");
    const [usage, globalPublished] = await Promise.all([
      this.repo.usageSince([key.keyId], localDayBounds(now, CAIRO).start),
      this.repo.globalPublishedSince(localDayBounds(now, content.timeZone).start),
    ]);
    const today = usage.get(key.keyId);
    const publishedToday = today?.publishedToday ?? 0;
    return {
      key: {
        id: key.keyId,
        name: key.keyName,
        environment: key.environment ?? null,
        scopes: key.scopes,
        can_publish: key.canPublish,
        allowed_types: key.allowedTypes,
        allowed_category_slugs: key.allowedCategorySlugs,
        default_author_id: key.defaultAuthorId,
        default_featured_media_id: key.defaultFeaturedMediaId,
        expires_at: key.expiresAt?.toISOString() ?? null,
      },
      limits: {
        requests_per_minute: key.requestsPerMinute,
        daily_publish_cap: key.dailyPublishCap,
      },
      today: {
        requests: today?.requestsToday ?? 0,
        publishes_remaining:
          key.dailyPublishCap === null ? null : Math.max(0, key.dailyPublishCap - publishedToday),
        global_publish_cap_remaining: Math.max(0, content.maxPublishesPerDay - globalPublished),
      },
    };
  }
}
