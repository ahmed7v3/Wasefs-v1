import { Inject, Injectable } from "@nestjs/common";
import {
  getMedication,
  medicationAlternatives,
  searchMedications,
  type MedicationSearchOptions,
} from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

import type {
  MedicationDetail,
  MedicationSearchResponse,
  MedicationSummary,
} from "@wasfa/shared/schemas/medications";

/** Thin wrapper: the queries live in `@wasfa/db` (`medication-search.ts`), shared with the agent tools. */
@Injectable()
export class MedicationsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  search(options: MedicationSearchOptions): Promise<MedicationSearchResponse> {
    return searchMedications(this.handle.db, options);
  }

  find(id: string): Promise<MedicationDetail | null> {
    return getMedication(this.handle.db, id);
  }

  alternatives(id: string, limit: number): Promise<MedicationSummary[]> {
    return medicationAlternatives(this.handle.db, id, limit);
  }
}
