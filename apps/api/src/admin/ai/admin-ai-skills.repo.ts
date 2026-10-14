import { Inject, Injectable } from "@nestjs/common";
import { plans } from "@wasfa/db";
import { asc } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface SkillPlan {
  key: string;
  nameAr: string;
  nameEn: string;
}

/** The plans a skill can be switched on for. */
@Injectable()
export class AdminAiSkillsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async plans(): Promise<SkillPlan[]> {
    return await this.handle.db
      .select({ key: plans.key, nameAr: plans.nameAr, nameEn: plans.nameEn })
      .from(plans)
      .orderBy(asc(plans.sort), asc(plans.key));
  }
}
