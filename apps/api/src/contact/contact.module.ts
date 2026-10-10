import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { ContactController } from "./contact.controller.js";
import { ContactRepo } from "./contact.repo.js";
import { ContactService } from "./contact.service.js";

/** Public contact form (Task 1.11): Turnstile, fail-closed rate limits, stored for the Phase 4 tickets. */
@Module({
  imports: [AuthModule],
  controllers: [ContactController],
  providers: [ContactRepo, ContactService],
})
export class ContactModule {}
