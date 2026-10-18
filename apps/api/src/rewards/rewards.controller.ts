import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import {
  convertPointsSchema,
  convertPreviewQuerySchema,
  meRewardsActivityQuerySchema,
} from "@wasfa/shared/schemas/rewards";

import { CurrentUser, type AuthenticatedUser } from "../common/current-user.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { RewardsService } from "./rewards.service.js";

class ActivityQueryDto extends createZodDto(meRewardsActivityQuerySchema) {}
class PreviewQueryDto extends createZodDto(convertPreviewQuerySchema) {}
class ConvertDto extends createZodDto(convertPointsSchema) {}

/** The caller's own rewards: balances, progress, activity and the points-to-credits conversion. */
@Controller("me/rewards")
export class MeRewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get()
  @RateLimit(60)
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.rewards.overview(user.id);
  }

  @Get("activity")
  @RateLimit(60)
  activity(@CurrentUser() user: AuthenticatedUser, @Query() query: ActivityQueryDto) {
    return this.rewards.activity(user.id, query);
  }

  @Get("convert/preview")
  @RateLimit(60)
  preview(@CurrentUser() user: AuthenticatedUser, @Query() query: PreviewQueryDto) {
    return this.rewards.preview(user.id, query.points);
  }

  @Post("convert")
  @HttpCode(200)
  @RateLimit(10, "1 hour")
  convert(@CurrentUser() user: AuthenticatedUser, @Body() body: ConvertDto) {
    return this.rewards.convert(user.id, body);
  }
}
