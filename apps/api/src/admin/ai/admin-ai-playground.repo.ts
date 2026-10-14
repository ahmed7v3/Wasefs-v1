import { Inject, Injectable } from "@nestjs/common";
import { aiModels, aiProviders } from "@wasfa/db";
import { inArray, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface PlaygroundModel {
  id: string;
  modelKey: string;
  providerKey: string;
}

/** The names shown next to a playground run. Keys and secrets are never selected. */
@Injectable()
export class AdminAiPlaygroundRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async models(ids: readonly string[]): Promise<PlaygroundModel[]> {
    return await this.handle.db
      .select({ id: aiModels.id, modelKey: aiModels.modelId, providerKey: aiProviders.key })
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
      .where(inArray(aiModels.id, [...ids]));
  }
}
