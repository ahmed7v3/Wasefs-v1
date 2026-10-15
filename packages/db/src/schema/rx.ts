import { AI_MODES } from "@wasfa/shared/ai";
import {
  RX_FIELDS,
  RX_INITIALS_MAX_LENGTH,
  RX_MAX_PAGES,
  RX_RATING_NOTE_MAX,
  RX_RATINGS,
  RX_STATUSES,
} from "@wasfa/shared/rx";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";
import { creditReservations } from "./credits.js";
import { files } from "./files.js";
import { ownerCheck, ownerColumns } from "./owner.js";
import { users } from "./users.js";

/*
 * One prescription analysis (a worker job on the `rx` queue). `result` holds the structured reading
 * validated by the shared `rxResultSchema`; the patient and prescriber are stored REDACTED
 * (initials only, ARCHITECTURE section 5.7). `cache_of` points at the analysis whose result was
 * reused. The partial index serves the global exact-match cache (same processed image + skill
 * version + route version).
 */
export const rxAnalyses = pgTable(
  "rx_analyses",
  {
    id: idColumn(),
    ...ownerColumns(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    status: text({ enum: RX_STATUSES }).notNull().default("queued"),
    mode: text({ enum: AI_MODES }).notNull(),
    creditsCharged: integer().notNull().default(0),
    reservationId: uuid().references(() => creditReservations.id, { onDelete: "set null" }),
    skillVersion: text().notNull(),
    routeVersion: integer(),
    inputSha256: text(),
    cacheOf: uuid().references((): AnyPgColumn => rxAnalyses.id, { onDelete: "set null" }),
    result: jsonb(),
    patientInitials: text(),
    prescriberInitials: text(),
    queuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    errorRef: text(),
    // The person's verdict on the analysis (Task 2.14). `share_for_review` is their explicit consent
    // that the image and the result may be shown to an admin to improve accuracy; it is off by default.
    rating: text({ enum: RX_RATINGS }),
    ratingNote: text(),
    shareForReview: boolean().notNull().default(false),
    ratedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    ownerCheck("rx_analyses", table),
    check(
      "rx_analyses_rating_check",
      sql`${table.rating} is null or ${table.rating} in ('good', 'bad')`,
    ),
    check(
      "rx_analyses_rating_note_check",
      sql`${table.ratingNote} is null or char_length(${table.ratingNote}) <= ${sql.raw(String(RX_RATING_NOTE_MAX))}`,
    ),
    check(
      "rx_analyses_share_needs_rating_check",
      sql`not ${table.shareForReview} or ${table.rating} is not null`,
    ),
    index("rx_analyses_shared_idx")
      .on(table.ratedAt.desc())
      .where(sql`${table.shareForReview}`),
    check("rx_analyses_status_check", inList(table.status, RX_STATUSES)),
    check("rx_analyses_mode_check", inList(table.mode, AI_MODES)),
    check("rx_analyses_credits_check", sql`${table.creditsCharged} >= 0`),
    check(
      "rx_analyses_patient_initials_check",
      sql`${table.patientInitials} is null or char_length(${table.patientInitials}) <= ${sql.raw(String(RX_INITIALS_MAX_LENGTH))}`,
    ),
    check(
      "rx_analyses_prescriber_initials_check",
      sql`${table.prescriberInitials} is null or char_length(${table.prescriberInitials}) <= ${sql.raw(String(RX_INITIALS_MAX_LENGTH))}`,
    ),
    index("rx_analyses_owner_user_created_idx").on(table.ownerUserId, table.createdAt.desc()),
    index("rx_analyses_owner_org_created_idx").on(table.ownerOrgId, table.createdAt.desc()),
    index("rx_analyses_cache_idx")
      .on(table.inputSha256, table.skillVersion, table.routeVersion)
      .where(sql`${table.status} = 'done'`),
  ],
);

/** The pages of an analysis, in order: one to four files. */
export const rxPages = pgTable(
  "rx_pages",
  {
    analysisId: uuid()
      .notNull()
      .references(() => rxAnalyses.id, { onDelete: "cascade" }),
    pageNo: integer().notNull(),
    // RESTRICT: an image still used by an analysis is not deleted from under it.
    fileId: uuid()
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.analysisId, table.pageNo], name: "rx_pages_pkey" }),
    check(
      "rx_pages_page_no_check",
      sql`${table.pageNo} between 1 and ${sql.raw(String(RX_MAX_PAGES))}`,
    ),
  ],
);

/** A user's fix to one field of one item. `consent_for_eval` is the user's opt-in to use it in the eval set. */
export const rxCorrections = pgTable(
  "rx_corrections",
  {
    id: idColumn(),
    analysisId: uuid()
      .notNull()
      .references(() => rxAnalyses.id, { onDelete: "cascade" }),
    itemIndex: integer().notNull(),
    field: text({ enum: RX_FIELDS }).notNull(),
    before: text(),
    after: text(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    consentForEval: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("rx_corrections_item_index_check", sql`${table.itemIndex} >= 0`),
    check("rx_corrections_field_check", inList(table.field, RX_FIELDS)),
  ],
);

export type RxAnalysis = typeof rxAnalyses.$inferSelect;
export type NewRxAnalysis = typeof rxAnalyses.$inferInsert;
export type RxPage = typeof rxPages.$inferSelect;
export type NewRxPage = typeof rxPages.$inferInsert;
export type RxCorrection = typeof rxCorrections.$inferSelect;
export type NewRxCorrection = typeof rxCorrections.$inferInsert;
