import { ONBOARDING_STEPS } from "@wasfa/shared/identity";
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { arrayWithin, inList, timestamps } from "./columns.js";
import { users } from "./users.js";

/** Resumable onboarding wizard state, one row per user. Ownership column: `user_id`. */
export const onboardingProgress = pgTable(
  "onboarding_progress",
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    currentStep: text({ enum: ONBOARDING_STEPS }).notNull().default("account_type"),
    completedSteps: text().array().notNull().default([]),
    // Answers collected so far, keyed by step; each step's shape is validated by the api (Task 1.7)
    // before it is written, never trusted from here.
    data: jsonb().notNull().default({}),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check("onboarding_progress_current_step_check", inList(table.currentStep, ONBOARDING_STEPS)),
    check(
      "onboarding_progress_completed_steps_check",
      arrayWithin(table.completedSteps, ONBOARDING_STEPS),
    ),
    check("onboarding_progress_data_check", sql`jsonb_typeof(${table.data}) = 'object'`),
    // Finished means parked on the terminal step, and the other way round.
    check(
      "onboarding_progress_done_sync_check",
      sql`(${table.completedAt} is not null) = (${table.currentStep} = 'done')`,
    ),
  ],
);

export type OnboardingProgress = typeof onboardingProgress.$inferSelect;
export type NewOnboardingProgress = typeof onboardingProgress.$inferInsert;
