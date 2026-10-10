import { Module } from "@nestjs/common";

import { OnboardingModule } from "../onboarding/onboarding.module.js";

import { UsersController } from "./users.controller.js";
import { UsersRepo } from "./users.repo.js";
import { UsersService } from "./users.service.js";

/** `/me`: profile, sessions and account deletion (Task 1.7). */
@Module({
  imports: [OnboardingModule],
  controllers: [UsersController],
  providers: [UsersRepo, UsersService],
})
export class UsersModule {}
