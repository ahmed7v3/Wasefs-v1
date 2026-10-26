import { Inject, Injectable } from "@nestjs/common";
import { isAppError } from "@wasfa/shared/errors";

import { CatalogService } from "../../catalog/catalog.service.js";
import { API_ENV } from "../../config/config.module.js";
import { MediaService } from "../../media/media.service.js";

import { AgentAccountService } from "./account-facts.service.js";
import { WaAgentHandoffService } from "./handoff.service.js";

import type { AgentToolDeps } from "./tools/index.js";
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
}
