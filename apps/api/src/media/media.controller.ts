import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import {
  createMediaUploadSchema,
  listMediaQuerySchema,
  mediaIdParamSchema,
  patchMediaSchema,
} from "@wasfa/shared/schemas/media";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { MediaService } from "./media.service.js";

import type { FastifyRequest } from "fastify";

class CreateUploadDto extends createZodDto(createMediaUploadSchema) {}
class PatchMediaDto extends createZodDto(patchMediaSchema) {}
class MediaIdParamDto extends createZodDto(mediaIdParamSchema) {}
class ListMediaQueryDto extends createZodDto(listMediaQuerySchema) {}

// Reuses the site-settings permissions (the closest existing ones: media is part of the public
// site's content). A dedicated `media.*` pair can replace them when the content roles land (WP3).
// `MediaService` writes the `media.*` audit rows.
@Controller("admin/media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post("uploads")
  @HttpCode(200)
  @RequirePermission("settings.write")
  @RateLimit(60)
  createUpload(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: CreateUploadDto,
  ) {
    return this.media.createUpload(actor.id, request, body);
  }

  @Post(":id/commit")
  @HttpCode(200)
  @RequirePermission("settings.write")
  @RateLimit(60)
  commit(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: MediaIdParamDto,
  ) {
    return this.media.commit(actor.id, request, params.id);
  }

  @Get()
  @RequirePermission("settings.read")
  @RateLimit(240)
  list(@Query() query: ListMediaQueryDto) {
    return this.media.list(query);
  }

  @Get(":id")
  @RequirePermission("settings.read")
  @RateLimit(240)
  get(@Param() params: MediaIdParamDto) {
    return this.media.get(params.id);
  }

  @Patch(":id")
  @RequirePermission("settings.write")
  @RateLimit(60)
  patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: MediaIdParamDto,
    @Body() body: PatchMediaDto,
  ) {
    return this.media.patch(actor.id, request, params.id, body);
  }
}
