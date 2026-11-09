import { Readable } from "node:stream";

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from "@nestjs/common";
import {
  telegramAdCampaignInputSchema,
  telegramAdCreativeInputSchema,
  telegramAdStatsQuerySchema,
  telegramAdStatusInputSchema,
  telegramAdsSettingsInputSchema,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import { z } from "zod";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminTelegramAdsService } from "./admin-telegram-ads.service.js";
import { patchSchemaOf } from "./telegram-ads-patch.js";

import type { FastifyRequest } from "fastify";

class IdDto extends createZodDto(z.object({ id: z.string().uuid() })) {}
class SettingsDto extends createZodDto(telegramAdsSettingsInputSchema) {}
class CampaignDto extends createZodDto(telegramAdCampaignInputSchema) {}
class CampaignPatchDto extends createZodDto(patchSchemaOf(telegramAdCampaignInputSchema)) {}
class CreativeDto extends createZodDto(telegramAdCreativeInputSchema) {}
class CreativePatchDto extends createZodDto(patchSchemaOf(telegramAdCreativeInputSchema)) {}
class CreativeListQueryDto extends createZodDto(
  z.object({ campaignId: z.string().uuid().optional() }),
) {}
class StatusDto extends createZodDto(telegramAdStatusInputSchema) {}
class StatsQueryDto extends createZodDto(telegramAdStatsQuerySchema) {}

/**
 * The console of the Telegram ads, independent from `/admin/ads`: reads need `ads.read`, every write
 * `ads.write` with a fresh login and an audit row (the settings write is audited by `SettingsService`).
 */
@Controller("admin/telegram/ads")
export class AdminTelegramAdsController {
  constructor(private readonly ads: AdminTelegramAdsService) {}

  @Get("settings")
  @RequirePermission("ads.read")
  @RateLimit(120)
  settings() {
    return this.ads.getSettings();
  }

  @Put("settings")
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  putSettings(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: SettingsDto,
  ) {
    return this.ads.putSettings(actor.id, request, body);
  }

  // --- campaigns ---

  @Get("campaigns")
  @RequirePermission("ads.read")
  @RateLimit(120)
  campaigns() {
    return this.ads.listCampaigns();
  }

  @Post("campaigns")
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "telegram_ads.campaign_created", targetType: "telegram_ad_campaign" })
  createCampaign(@Body() body: CampaignDto, @AuditCtx() audit: AuditScope) {
    return this.ads.createCampaign(body, audit);
  }

  @Patch("campaigns/:id")
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({
    action: "telegram_ads.campaign_updated",
    targetType: "telegram_ad_campaign",
    targetParam: "id",
  })
  updateCampaign(
    @Param() params: IdDto,
    @Body() body: CampaignPatchDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.ads.updateCampaign(params.id, body, audit);
  }

  @Delete("campaigns/:id")
  @HttpCode(204)
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "telegram_ads.campaign_deleted",
    targetType: "telegram_ad_campaign",
    targetParam: "id",
  })
  async deleteCampaign(@Param() params: IdDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.ads.deleteCampaign(params.id, audit);
  }

  // --- creatives ---

  @Get("creatives")
  @RequirePermission("ads.read")
  @RateLimit(120)
  creatives(@Query() query: CreativeListQueryDto) {
    return this.ads.listCreatives(query.campaignId);
  }

  @Post("creatives")
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "telegram_ads.creative_created", targetType: "telegram_ad_creative" })
  createCreative(@Body() body: CreativeDto, @AuditCtx() audit: AuditScope) {
    return this.ads.createCreative(body, audit);
  }

  @Patch("creatives/:id")
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({
    action: "telegram_ads.creative_updated",
    targetType: "telegram_ad_creative",
    targetParam: "id",
  })
  updateCreative(
    @Param() params: IdDto,
    @Body() body: CreativePatchDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.ads.updateCreative(params.id, body, audit);
  }

  @Post("creatives/:id/status")
  @HttpCode(200)
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(60)
  @Audited({
    action: "telegram_ads.creative_status_changed",
    targetType: "telegram_ad_creative",
    targetParam: "id",
  })
  setStatus(@Param() params: IdDto, @Body() body: StatusDto, @AuditCtx() audit: AuditScope) {
    return this.ads.setCreativeStatus(params.id, body.status, audit);
  }

  @Post("creatives/:id/test-send")
  @HttpCode(200)
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "telegram_ads.creative_test_sent",
    targetType: "telegram_ad_creative",
    targetParam: "id",
  })
  async testSend(
    @Param() params: IdDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    const result = await this.ads.testSend(actor.id, params.id);
    audit.after = result;
    return result;
  }

  @Delete("creatives/:id")
  @HttpCode(204)
  @RequirePermission("ads.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "telegram_ads.creative_deleted",
    targetType: "telegram_ad_creative",
    targetParam: "id",
  })
  async deleteCreative(@Param() params: IdDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.ads.deleteCreative(params.id, audit);
  }

  // --- analytics ---

  @Get("stats")
  @RequirePermission("ads.read")
  @RateLimit(60)
  stats(@Query() query: StatsQueryDto) {
    return this.ads.stats(query);
  }

  @Get("stats/export")
  @RequirePermission("ads.read")
  @RateLimit(10)
  @Header("Cache-Control", "no-store")
  async export(@Query() query: StatsQueryDto): Promise<StreamableFile> {
    const lines = await this.ads.statsCsv(query);
    return new StreamableFile(Readable.from(lines), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="telegram-ads.csv"',
    });
  }
}
