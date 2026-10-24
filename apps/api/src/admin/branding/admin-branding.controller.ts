import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import { brandingAssetParamSchema, putBrandingAssetSchema } from "@wasfa/shared/schemas/branding";

import { BrandingService } from "../../branding/branding.service.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import type { FastifyRequest } from "fastify";

class AssetParamDto extends createZodDto(brandingAssetParamSchema) {}
class PutAssetDto extends createZodDto(putBrandingAssetSchema) {}

// `BrandingService` writes the `setting.update` and `branding.asset_*` (upload, delete, revert) audit rows itself.
@Controller("admin/branding/assets")
export class AdminBrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @RequirePermission("settings.read")
  @RateLimit(60)
  list() {
    return this.branding.list();
  }

  @Put(":key")
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: AssetParamDto,
    @Body() body: PutAssetDto,
  ) {
    return this.branding.upload(actor.id, request, params.key, body.dataUrl);
  }

  @Delete(":key")
  @HttpCode(204)
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: AssetParamDto,
  ): Promise<void> {
    await this.branding.remove(actor.id, request, params.key);
  }

  /** Puts the newest archived version of the key back live (the version it replaces is archived). */
  @Post(":key/revert")
  @HttpCode(200)
  @RequirePermission("settings.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  revert(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: AssetParamDto,
  ) {
    return this.branding.revert(actor.id, request, params.key);
  }
}
