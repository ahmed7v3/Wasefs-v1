import { Module } from "@nestjs/common";

import { PhoneModule } from "../phone/phone.module.js";

import { OnboardingController } from "./onboarding.controller.js";
import { OnboardingRepo } from "./onboarding.repo.js";
import { OnboardingService } from "./onboarding.service.js";

/** Resumable onboarding wizard (Task 1.7). `OnboardingService.summary` also feeds `GET /me`. */
@Module({
  imports: [PhoneModule],
  controllers: [OnboardingController],
  providers: [OnboardingRepo, OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
