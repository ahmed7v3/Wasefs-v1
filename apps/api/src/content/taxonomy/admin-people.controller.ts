import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { contentIdParamSchema, personInputSchema } from "@wasfa/shared/schemas/content";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { PeopleService } from "./people.service.js";

import type { FastifyRequest } from "fastify";

class PersonDto extends createZodDto(personInputSchema) {}
class IdDto extends createZodDto(contentIdParamSchema) {}

/** Authors and reviewers. The licence number is returned here (admins only) and never audited. */
@Controller("admin/content/people")
export class AdminPeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  @RequirePermission("content.read")
  @RateLimit(240)
  list() {
    return this.people.list();
  }

  @Post()
  @RequirePermission("content.manage")
  @RateLimit(60)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Body() body: PersonDto,
  ) {
    return this.people.create(actor.id, request, body);
  }

  @Patch(":id")
  @RequirePermission("content.manage")
  @RateLimit(60)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: IdDto,
    @Body() body: PersonDto,
  ) {
    return this.people.update(actor.id, request, params.id, body);
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
    return this.people.remove(actor.id, request, params.id);
  }
}
