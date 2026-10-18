import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from "@nestjs/common";
import {
  adminPhiSessionSchema,
  adminUserChatParamsSchema,
  adminUserPageQuerySchema,
  adminUserParamsSchema,
  adminUserRxParamsSchema,
} from "@wasfa/shared/schemas/admin-user-360";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireAnyPermission, RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { NoStoreInterceptor } from "./no-store.interceptor.js";
import { AdminUserPhiService } from "./user-phi.service.js";

import type { FastifyRequest } from "fastify";

class UserParamsDto extends createZodDto(adminUserParamsSchema) {}
class RxParamsDto extends createZodDto(adminUserRxParamsSchema) {}
class ChatParamsDto extends createZodDto(adminUserChatParamsSchema) {}
class PageQueryDto extends createZodDto(adminUserPageQuerySchema) {}
class PhiSessionDto extends createZodDto(adminPhiSessionSchema) {}

/**
 * Health data of a user (Decision 12): prescriptions and chats. Everything answers
 * `Cache-Control: no-store`; there is no export route on purpose.
 */
@Controller("admin/users/:id")
@UseInterceptors(NoStoreInterceptor)
export class AdminUserPhiController {
  constructor(private readonly phi: AdminUserPhiService) {}

  @Post("phi-sessions")
  @RequireAnyPermission("users.read_health", "users.read_chats")
  @RateLimit(20)
  startSession(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserParamsDto,
    @Body() body: PhiSessionDto,
    @Req() request: FastifyRequest,
  ) {
    return this.phi.startSession(actor, params.id, body, request);
  }

  @Get("phi-sessions")
  @RequireAnyPermission("users.read_health", "users.read_chats")
  @RateLimit(60)
  activeSession(@CurrentUser() actor: AuthenticatedUser, @Param() params: UserParamsDto) {
    return this.phi.activeSession(actor, params.id);
  }

  @Get("prescriptions")
  @RequirePermission("users.read_health")
  @RateLimit(120)
  prescriptions(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.phi.prescriptions(params.id, query);
  }

  @Get("prescriptions/:rxId")
  @RequirePermission("users.read_health")
  @RateLimit(60)
  openPrescription(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: RxParamsDto,
    @Req() request: FastifyRequest,
  ) {
    return this.phi.openPrescription(actor, params.id, params.rxId, request);
  }

  @Get("chats")
  @RequirePermission("users.read_chats")
  @RateLimit(120)
  chats(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.phi.chatList(params.id, query);
  }

  @Get("chats/:chatId")
  @RequirePermission("users.read_chats")
  @RateLimit(60)
  openChat(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: ChatParamsDto,
    @Query() query: PageQueryDto,
    @Req() request: FastifyRequest,
  ) {
    return this.phi.openChat(actor, params.id, params.chatId, query, request);
  }
}
