import { EVAL_RUN_STATUSES } from "@wasfa/shared/ai";
import { EVAL_ITEM_KINDS } from "@wasfa/shared/rx";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * Accuracy evaluation of prescription reading (Task 2.10). Platform data: items reference real
 * prescription images collected with consent. A run snapshots the routes it used, so its scores stay
 * meaningful after the routes change.
 */

export const aiEvalSets = pgTable("ai_eval_sets", {
  id: idColumn(),
  key: text().notNull().unique("ai_eval_sets_key_key"),
  name: text().notNull(),
  description: text(),
  ...timestamps(),
});

export const aiEvalItems = pgTable(
  "ai_eval_items",
  {
    id: idColumn(),
    setId: uuid()
      .notNull()
      .references(() => aiEvalSets.id, { onDelete: "cascade" }),
    // The pages of the prescription. An array cannot carry foreign keys: the service checks the ids.
    fileIds: uuid().array().notNull(),
    kind: text({ enum: EVAL_ITEM_KINDS }).notNull(),
    // The correct reading, in the shared `rxResultSchema` shape.
    expected: jsonb().notNull(),
    ...timestamps(),
  },
  (table) => [check("ai_eval_items_kind_check", inList(table.kind, EVAL_ITEM_KINDS))],
);

export const aiEvalRuns = pgTable(
  "ai_eval_runs",
  {
    id: idColumn(),
    // RESTRICT: a set with recorded runs is kept; archive instead of deleting.
    setId: uuid()
      .notNull()
      .references(() => aiEvalSets.id, { onDelete: "restrict" }),
    routeSnapshot: jsonb().notNull(),
    status: text({ enum: EVAL_RUN_STATUSES }).notNull().default("queued"),
    metrics: jsonb(),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    startedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ai_eval_runs_status_check", inList(table.status, EVAL_RUN_STATUSES)),
    check("ai_eval_runs_cost_check", sql`${table.costUsdMicros} >= 0`),
  ],
);

export const aiEvalResults = pgTable(
  "ai_eval_results",
  {
    runId: uuid()
      .notNull()
      .references(() => aiEvalRuns.id, { onDelete: "cascade" }),
    itemId: uuid()
      .notNull()
      .references(() => aiEvalItems.id, { onDelete: "cascade" }),
    output: jsonb(),
    scores: jsonb(),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    latencyMs: integer(),
    error: text(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.itemId], name: "ai_eval_results_pkey" }),
    check("ai_eval_results_cost_check", sql`${table.costUsdMicros} >= 0`),
    check(
      "ai_eval_results_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
  ],
);

export type AiEvalSet = typeof aiEvalSets.$inferSelect;
export type NewAiEvalSet = typeof aiEvalSets.$inferInsert;
export type AiEvalItem = typeof aiEvalItems.$inferSelect;
export type NewAiEvalItem = typeof aiEvalItems.$inferInsert;
export type AiEvalRun = typeof aiEvalRuns.$inferSelect;
export type NewAiEvalRun = typeof aiEvalRuns.$inferInsert;
export type AiEvalResult = typeof aiEvalResults.$inferSelect;
export type NewAiEvalResult = typeof aiEvalResults.$inferInsert;
