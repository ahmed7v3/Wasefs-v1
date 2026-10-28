import { Inject, Injectable } from "@nestjs/common";
import { medicationAlternatives, searchMedications } from "@wasfa/db";
import { isAppError } from "@wasfa/shared/errors";

import { CatalogService } from "../../catalog/catalog.service.js";
import { DB, type DbHandle } from "../../common/database.js";
import { API_ENV } from "../../config/config.module.js";
import { MediaService } from "../../media/media.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { AgentDiscountService } from "../commerce/agent-discount.service.js";
import { AgentMedicalService } from "../commerce/agent-medical.service.js";
import { AgentRxService } from "../commerce/agent-rx.service.js";
import { AgentSubscriptionService } from "../commerce/agent-subscription.service.js";
import { AgentDocumentService, type DocumentCall } from "../documents/agent-document.service.js";

import { AgentAccountService } from "./account-facts.service.js";
import { WaAgentHandoffService } from "./handoff.service.js";

import type { AgentCall, AgentToolDeps } from "./tools/index.js";
import type { Market } from "../../catalog/market.js";
import type { ApiEnv } from "../../config/env.js";
import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

/** The services behind the agent's tools, behind one provider so a turn takes a single dependency. */
@Injectable()
export class WaAgentToolDeps implements AgentToolDeps {
  readonly mediaOrigin: string;

  constructor(
    private readonly catalogService: CatalogService,
    private readonly accountService: AgentAccountService,
    private readonly mediaService: MediaService,
    private readonly handoffService: WaAgentHandoffService,
    private readonly discounts: AgentDiscountService,
    private readonly subscriptions: AgentSubscriptionService,
    private readonly prescriptions: AgentRxService,
    private readonly medical: AgentMedicalService,
    private readonly documentService: AgentDocumentService,
    @Inject(DB) private readonly dbHandle: DbHandle,
    private readonly settings: SettingsService,
    @Inject(API_ENV) env: Pick<ApiEnv, "MEDIA_PUBLIC_ORIGIN">,
  ) {
    this.mediaOrigin = env.MEDIA_PUBLIC_ORIGIN ?? "";
  }

  readonly catalog = {
    catalog: (market: Market): Promise<CatalogResponse> => this.catalogService.catalog(market),
  };

  readonly account = {
    status: (userId: string, now: Date) => this.accountService.status(userId, now),
  };

  readonly media = {
    find: async (id: string): Promise<MediaAsset | null> => {
      try {
        return await this.mediaService.get(id);
      } catch (error) {
        // A deleted asset is "not found" to the tool; anything else is a real failure.
        if (isAppError(error) && error.httpStatus === 404) return null;
        throw error;
      }
    },
  };

  readonly handoff = {
    raise: (conversationId: string, reason: string) =>
      this.handoffService.raise(conversationId, reason),
  };

  readonly commerce = {
    offerDiscount: (call: AgentCall, planKey: string, months: number) =>
      this.discounts.offer(call, planKey, months),
    startSubscription: (
      call: AgentCall,
      input: { planKey: string; months: number; couponCode?: string | undefined },
    ) => this.subscriptions.start(call, input),
    attachReceipt: (call: AgentCall) => this.subscriptions.attachReceipt(call),
  };

  readonly documents = {
    create: (call: DocumentCall) => this.documentService.create(call),
  };

  readonly usage = {
    analyzePrescription: (call: AgentCall) => this.prescriptions.analyze(call),
    askMedical: (call: AgentCall, question: string) => this.medical.ask(call, question),
  };

  readonly medications = {
    search: async (query: string, limit: number) =>
      (await searchMedications(this.dbHandle.db, { q: query, limit })).items,
    alternatives: (drugId: string, limit: number) =>
      medicationAlternatives(this.dbHandle.db, drugId, limit),
    showPrices: async () => (await this.settings.get("medications")).search.showPrices,
  };
}
