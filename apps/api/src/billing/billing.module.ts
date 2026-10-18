import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { OrgsModule } from "../orgs/orgs.module.js";

import { DEAL_RESOLVER, DbDealResolver } from "./deal-resolver.js";
import { QuoteInputsRepo } from "./quote-inputs.repo.js";
import { QuoteController } from "./quote.controller.js";
import { QuoteService } from "./quote.service.js";

/** `POST /billing/quote` and the stored, signed quotes that checkout (Task 3.3) will verify. */
@Module({
  imports: [AuthModule, OrgsModule],
  controllers: [QuoteController],
  providers: [
    QuoteInputsRepo,
    QuoteService,
    { provide: DEAL_RESOLVER, useClass: DbDealResolver },
  ],
  exports: [QuoteService, QuoteInputsRepo, DEAL_RESOLVER],
})
export class BillingModule {}
