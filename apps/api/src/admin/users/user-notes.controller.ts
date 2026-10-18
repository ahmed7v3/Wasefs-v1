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
  adminNoteCreateSchema,
  adminNotePatchSchema,
  adminUserNoteParamsSchema,
  adminUserPageQuerySchema,
  adminUserParamsSchema,
} from "@wasfa/shared/schemas/admin-user-360";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminUserNotesService } from "./user-notes.service.js";

import type { FastifyRequest } from "fastify";

class UserParamsDto extends createZodDto(adminUserParamsSchema) {}
class NoteParamsDto extends createZodDto(adminUserNoteParamsSchema) {}
class PageQueryDto extends createZodDto(adminUserPageQuerySchema) {}
class NoteCreateDto extends createZodDto(adminNoteCreateSchema) {}
class NotePatchDto extends createZodDto(adminNotePatchSchema) {}

/** Internal notes on a user (support history); `users.read` is enough to read and to write. */
@Controller("admin/users/:id/notes")
export class AdminUserNotesController {
  constructor(private readonly notes: AdminUserNotesService) {}

  @Get()
  @RequirePermission("users.read")
  @RateLimit(120)
  list(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.notes.list(params.id, query);
  }

  @Post()
  @RequirePermission("users.read")
  @RateLimit(30)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserParamsDto,
    @Body() body: NoteCreateDto,
    @Req() request: FastifyRequest,
  ) {
    return this.notes.create(actor, params.id, body, request);
  }

  @Patch(":noteId")
  @RequirePermission("users.read")
  @RateLimit(30)
  patch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: NoteParamsDto,
    @Body() body: NotePatchDto,
    @Req() request: FastifyRequest,
  ) {
    return this.notes.patch(actor, params.id, params.noteId, body, request);
  }

  @Delete(":noteId")
  @HttpCode(200)
  @RequirePermission("users.read")
  @RateLimit(30)
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: NoteParamsDto,
    @Req() request: FastifyRequest,
  ) {
    return this.notes.remove(actor, params.id, params.noteId, request);
  }
}
