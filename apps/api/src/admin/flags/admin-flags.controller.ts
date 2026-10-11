import { Body, Controller, Delete, Get, HttpCode, Param, Put, Req } from "@nestjs/common";
import { flagKeyParamSchema } from "@wasfa/shared/schemas/admin";
import { upsertFlagSchema } from "@wasfa/shared/settings";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminFlagsService } from "./admin-flags.service.js";

import type { FastifyRequest } from "fastify";

class FlagKeyParamDto extends createZodDto(flagKeyParamSchema) {}
class UpsertFlagDto extends createZodDto(upsertFlagSchema) {}

// `FlagsService.set` / `remove` write the `flag.update` / `flag.delete` audit rows themselves.
@Controller("admin/flags")
export class AdminFlagsController {
  constructor(private readonly flags: AdminFlagsService) {}

  @Get()
  @RequirePermission("flags.read")
  @RateLimit(120)
  list() {
    return this.flags.list();
  }

  @Put(":key")
  @RequirePermission("flags.write")
  @RateLimit(30)
  put(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: FlagKeyParamDto,
    @Body() body: UpsertFlagDto,
  ) {
    return this.flags.put(actor.id, request, params.key, body);
  }

  @Delete(":key")
  @HttpCode(204)
  @RequirePermission("flags.write")
  @RateLimit(30)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: FlagKeyParamDto,
  ): Promise<void> {
    await this.flags.remove(actor.id, request, params.key);
  }
}
