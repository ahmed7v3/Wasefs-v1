import { Controller, Get, Param, Query } from "@nestjs/common";
import { medicationSearchQuerySchema } from "@wasfa/shared/schemas/medications";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { MedicationsService } from "./medications.service.js";

class SearchDto extends createZodDto(medicationSearchQuerySchema) {}
class IdParamDto extends createZodDto(idParamSchema) {}

/**
 * Medication search for signed-in users (the global guard requires a session). The per-user limit
 * is in the service; the route limit is per address. `search` is declared before `:id`.
 */
@Controller("medications")
export class MedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  @Get("search")
  @RateLimit(120)
  search(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchDto) {
    return this.medications.search(user.id, query);
  }

  @Get(":id")
  @RateLimit(120)
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: IdParamDto) {
    return this.medications.get(user.id, params.id);
  }
}
