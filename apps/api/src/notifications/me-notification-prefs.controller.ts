import { Body, Controller, Get, Put } from "@nestjs/common";
import { updateNotificationPrefsSchema } from "@wasfa/shared/schemas/notification-prefs";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { NotificationPrefsService } from "./notification-prefs.service.js";

class UpdatePrefsDto extends createZodDto(updateNotificationPrefsSchema) {}

/** The caller's own notification channels. */
@Controller("me/notification-prefs")
export class MeNotificationPrefsController {
  constructor(private readonly prefs: NotificationPrefsService) {}

  @Get()
  @RateLimit(60)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.prefs.mine(user.id);
  }

  @Put()
  @RateLimit(10)
  update(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdatePrefsDto) {
    return this.prefs.update(user.id, body);
  }
}
