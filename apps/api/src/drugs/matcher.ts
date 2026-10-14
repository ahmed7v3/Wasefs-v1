import { Inject, Injectable } from "@nestjs/common";
import { matchDrug, type MatchDrugOptions } from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

import type { DrugMatchCandidate } from "@wasfa/shared/drugs";

/**
 * `matchDrug(text, { strength?, form? })`: the top 5 drugs for a name as written on a prescription,
 * a box or a list, each with its score and why. A thin wrapper: the query lives in `@wasfa/db`
 * (`drug-matcher.ts`) so the worker can run the very same one.
 */
@Injectable()
export class DrugMatcher {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  matchDrug(text: string, options: MatchDrugOptions = {}): Promise<DrugMatchCandidate[]> {
    return matchDrug(this.handle.db, text, options);
  }
}
