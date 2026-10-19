import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  adminAlertPrefsSchema,
  alertCursorSchema,
  alertIdParamSchema,
  resolveAlertParamSchema,
} from "@wasfa/shared/schemas/admin-alerts";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { AdminAlertService } from "./alerts.service.js";

class CursorDto extends createZodDto(alertCursorSchema) {}
class DeliveryDto extends createZodDto(alertIdParamSchema) {}
class ResolveDto extends createZodDto(resolveAlertParamSchema) {}
class PrefsDto extends createZodDto(adminAlertPrefsSchema) {}

@Controller("admin/alerts")
@RequirePermission("alerts.receive")
export class AlertsController {
  constructor(private readonly alerts: AdminAlertService) {}

  @Get()
  @RateLimit(120)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorDto) {
    return this.alerts.list(user.id, query.limit, query.cursor);
  }

  @Post(":deliveryId/read")
  @RateLimit(60)
  async read(@Param() params: DeliveryDto, @CurrentUser() user: AuthenticatedUser) {
    if (!(await this.alerts.markRead(user.id, params.deliveryId)))
      throw new AppError(ErrorCode.NOT_FOUND);
    return { read: true };
  }

  @Post("read-all")
  @RateLimit(20)
  async readAll(@CurrentUser() user: AuthenticatedUser) {
    await this.alerts.readAll(user.id);
    return { read: true };
  }

  /** Sends the caller a test alert on every channel they have switched on (nobody else gets it). */
  @Post("test")
  @RateLimit(3)
  test(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.sendTest(user.id);
  }

  @Get("health")
  @RateLimit(30)
  health(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.health(user.id);
  }

  @Get("prefs")
  @RateLimit(60)
  prefs(@CurrentUser() user: AuthenticatedUser) {
    return this.alerts.prefs(user.id);
  }

  @Put("prefs")
  @RateLimit(10)
  async updatePrefs(@Body() body: PrefsDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.alerts.updatePrefs(user.id, body);
    if ("error" in result)
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: result.error } });
    return result.row;
  }

  @Post(":alertId/resolve")
  @RateLimit(30)
  resolve(@Param() params: ResolveDto, @CurrentUser() user: AuthenticatedUser) {
    return this.alerts.resolve(params.alertId, user);
  }
}
