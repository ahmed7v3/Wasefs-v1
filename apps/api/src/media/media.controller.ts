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

// Media belongs to the content platform: `content.read` / `content.write` (admin and marketing roles
// hold them; super_admin has everything). `MediaService` writes the `media.*` audit rows.
@Controller("admin/media")
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post("uploads")
  @HttpCode(200)
  @RequirePermission("content.write")
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
  @RequirePermission("content.write")
  @RateLimit(60)
  commit(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: MediaIdParamDto,
  ) {
    return this.media.commit(actor.id, request, params.id);
  }

  @Get()
  @RequirePermission("content.read")
  @RateLimit(240)
  list(@Query() query: ListMediaQueryDto) {
    return this.media.list(query);
  }

  @Get(":id")
  @RequirePermission("content.read")
  @RateLimit(240)
  get(@Param() params: MediaIdParamDto) {
    return this.media.get(params.id);
  }

  @Get(":id/usage")
  @RequirePermission("content.read")
  @RateLimit(240)
  usage(@Param() params: MediaIdParamDto) {
    return this.media.usage(params.id);
  }

  @Patch(":id")
  @RequirePermission("content.write")
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
