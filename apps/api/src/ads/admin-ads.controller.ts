import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  adIdParamSchema,
  adPlacementKeyParamSchema,
  adStatsQuerySchema,
  adminCreativeListQuerySchema,
  advertiserInputSchema,
  createCreativeSchema,
  creativeStatusActionSchema,
  updateAdsSettingsSchema,
  updateAdvertiserSchema,
  updateCreativeSchema,
  updatePlacementSchema,
} from "@wasfa/shared/ads";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { AdminAdsService } from "./admin-ads.service.js";

import type { FastifyRequest } from "fastify";

class IdDto extends createZodDto(adIdParamSchema) {}
class PlacementKeyDto extends createZodDto(adPlacementKeyParamSchema) {}
class UpdatePlacementDto extends createZodDto(updatePlacementSchema) {}
class CreativeListQueryDto extends createZodDto(adminCreativeListQuerySchema) {}
class CreateCreativeDto extends createZodDto(createCreativeSchema) {}
class UpdateCreativeDto extends createZodDto(updateCreativeSchema) {}
class CreativeStatusDto extends createZodDto(creativeStatusActionSchema) {}
class CreateAdvertiserDto extends createZodDto(advertiserInputSchema) {}
class UpdateAdvertiserDto extends createZodDto(updateAdvertiserSchema) {}
class StatsQueryDto extends createZodDto(adStatsQuerySchema) {}
class UpdateSettingsDto extends createZodDto(updateAdsSettingsSchema) {}

/**
 * The ads console API (docs/ADS.md §6): reads need `ads.read`, every write `ads.write` and an audit
 * row. The settings write is audited by `SettingsService` itself.
 */
@Controller("admin/ads")
export class AdminAdsController {
  constructor(private readonly ads: AdminAdsService) {}

  @Get("settings")
  @RequirePermission("ads.read")
  @RateLimit(120)
  settings() {
    return this.ads.getSettings();
  }

  @Patch("settings")
  @RequirePermission("ads.write")
  @RateLimit(30)
  updateSettings(
    @Body() body: UpdateSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.ads.updateSettings(body, { actorId: actor.id, request });
  }

  @Get("stats")
  @RequirePermission("ads.read")
  @RateLimit(60)
  stats(@Query() query: StatsQueryDto) {
    return this.ads.stats(query);
  }

  @Get("placements")
  @RequirePermission("ads.read")
  @RateLimit(120)
  placements() {
    return this.ads.listPlacements();
  }

  @Patch("placements/:key")
  @RequirePermission("ads.write")
  @RateLimit(30)
  @Audited({ action: "ad_placement.updated", targetType: "ad_placement", targetParam: "key" })
  updatePlacement(
    @Param() params: PlacementKeyDto,
    @Body() body: UpdatePlacementDto,
    @AuditCtx() audit: AuditScope,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
  ) {
    return this.ads.updatePlacement(params.key, body, audit, { actorId: actor.id, request });
  }

  @Get("creatives")
  @RequirePermission("ads.read")
  @RateLimit(120)
  creatives(@Query() query: CreativeListQueryDto) {
    return this.ads.listCreatives(query);
  }

  @Get("creatives/:id")
  @RequirePermission("ads.read")
  @RateLimit(120)
  creative(@Param() params: IdDto) {
    return this.ads.getCreative(params.id);
  }

  @Post("creatives")
  @RequirePermission("ads.write")
  @RateLimit(30)
  @Audited({ action: "ad_creative.created", targetType: "ad_creative" })
  createCreative(@Body() body: CreateCreativeDto, @AuditCtx() audit: AuditScope) {
    return this.ads.createCreative(body, audit);
  }

  @Patch("creatives/:id")
  @RequirePermission("ads.write")
  @RateLimit(60)
  @Audited({ action: "ad_creative.updated", targetType: "ad_creative", targetParam: "id" })
  updateCreative(
    @Param() params: IdDto,
    @Body() body: UpdateCreativeDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.ads.updateCreative(params.id, body, audit);
  }

  @Post("creatives/:id/status")
  @HttpCode(200)
  @RequirePermission("ads.write")
  @RateLimit(60)
  @Audited({ action: "ad_creative.status_changed", targetType: "ad_creative", targetParam: "id" })
  setCreativeStatus(
    @Param() params: IdDto,
    @Body() body: CreativeStatusDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.ads.setCreativeStatus(params.id, body.status, audit);
  }

  @Delete("creatives/:id")
  @HttpCode(204)
  @RequirePermission("ads.write")
  @RateLimit(30)
  @Audited({ action: "ad_creative.deleted", targetType: "ad_creative", targetParam: "id" })
  async deleteCreative(@Param() params: IdDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.ads.deleteCreative(params.id, audit);
  }

  @Get("advertisers")
  @RequirePermission("ads.read")
  @RateLimit(120)
  advertisers() {
    return this.ads.listAdvertisers();
  }

  @Post("advertisers")
  @RequirePermission("ads.write")
  @RateLimit(30)
  @Audited({ action: "advertiser.created", targetType: "advertiser" })
  createAdvertiser(@Body() body: CreateAdvertiserDto, @AuditCtx() audit: AuditScope) {
    return this.ads.createAdvertiser(body, audit);
  }

  @Patch("advertisers/:id")
  @RequirePermission("ads.write")
  @RateLimit(30)
  @Audited({ action: "advertiser.updated", targetType: "advertiser", targetParam: "id" })
  updateAdvertiser(
    @Param() params: IdDto,
    @Body() body: UpdateAdvertiserDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.ads.updateAdvertiser(params.id, body, audit);
  }

  @Delete("advertisers/:id")
  @HttpCode(204)
  @RequirePermission("ads.write")
  @RateLimit(30)
  @Audited({ action: "advertiser.deleted", targetType: "advertiser", targetParam: "id" })
  async deleteAdvertiser(@Param() params: IdDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.ads.deleteAdvertiser(params.id, audit);
  }
}
