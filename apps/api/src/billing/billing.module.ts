import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { DEAL_RESOLVER, NullDealResolver } from "./deal-resolver.js";
import { QuoteInputsRepo } from "./quote-inputs.repo.js";
import { QuoteController } from "./quote.controller.js";
import { QuoteService } from "./quote.service.js";

/** `POST /billing/quote` and the stored, signed quotes that checkout (Task 3.3) will verify. */
@Module({
  imports: [AuthModule],
  controllers: [QuoteController],
  providers: [
    QuoteInputsRepo,
    QuoteService,
    // Task 3.10 (WP6) replaces this binding with the real deal resolver.
    { provide: DEAL_RESOLVER, useClass: NullDealResolver },
  ],
  exports: [QuoteService, QuoteInputsRepo],
})
export class BillingModule {}
