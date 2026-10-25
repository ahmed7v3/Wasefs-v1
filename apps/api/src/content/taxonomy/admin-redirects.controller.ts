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
  contentIdParamSchema,
  redirectInputSchema,
  redirectListQuerySchema,
  redirectTestQuerySchema,
} from "@wasfa/shared/schemas/content";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { RedirectsService } from "./redirects.service.js";

import type { FastifyRequest } from "fastify";

class RedirectDto extends createZodDto(redirectInputSchema) {}
class ListDto extends createZodDto(redirectListQuerySchema) {}
class TestDto extends createZodDto(redirectTestQuerySchema) {}
class IdDto extends createZodDto(contentIdParamSchema) {}

@Controller("admin/content/redirects")
export class AdminRedirectsController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  @RequirePermission("content.read")
  @RateLimit(240)
  list(@Query() query: ListDto) {
    return this.redirects.list(query);
  }

  @Get("test")
  @RequirePermission("content.read")
  @RateLimit(120)
  test(@Query() query: TestDto) {
    return this.redirects.test(query.path);
  }

  @Post()
  @RequirePermission("content.manage")
  @RateLimit(60)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: RedirectDto,
  ) {
    return this.redirects.create(actor.id, request, body);
  }

  @Patch(":id")
  @RequirePermission("content.manage")
  @RateLimit(60)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
    @Body() body: RedirectDto,
  ) {
    return this.redirects.update(actor.id, request, params.id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("content.manage")
  @RateLimit(60)
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
  ) {
    return this.redirects.remove(actor.id, request, params.id);
  }
}
