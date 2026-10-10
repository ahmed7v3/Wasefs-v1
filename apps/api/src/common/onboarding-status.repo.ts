import { Inject, Injectable } from "@nestjs/common";
import { onboardingProgress } from "@wasfa/db";
import { and, eq, isNotNull } from "drizzle-orm";

import { DB, type DbHandle } from "./database.js";

/** The one question `VerifiedGuard` asks the database: has this user finished onboarding? */
@Injectable()
export class OnboardingStatusRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async isDone(userId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ userId: onboardingProgress.userId })
      .from(onboardingProgress)
      .where(and(eq(onboardingProgress.userId, userId), isNotNull(onboardingProgress.completedAt)))
      .limit(1);
    return row !== undefined;
  }
}
