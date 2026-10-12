import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { createUploadSchema } from "@wasfa/shared/schemas/files";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";
import { RequireVerified } from "../common/verified.guard.js";

import { FilesService } from "./files.service.js";

class CreateUploadDto extends createZodDto(createUploadSchema) {}
class FileIdParamDto extends createZodDto(idParamSchema) {}

/**
 * Uploads and image links (Task 2.5). Tool routes: a verified, onboarded account. The 30 per 10
 * minutes per user limit lives in the service; the route limits below are per IP.
 */
@Controller()
@RequireVerified()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post("uploads")
  @RateLimit(60)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateUploadDto) {
    return this.files.createUpload(user, body);
  }

  @Post("uploads/:id/complete")
  @HttpCode(200)
  @RateLimit(60)
  complete(@CurrentUser() user: AuthenticatedUser, @Param() params: FileIdParamDto) {
    return this.files.completeUpload(user, params.id);
  }

  @Get("files/:id/url")
  @RateLimit(120)
  url(@CurrentUser() user: AuthenticatedUser, @Param() params: FileIdParamDto) {
    return this.files.viewUrl(user, params.id);
  }
}
