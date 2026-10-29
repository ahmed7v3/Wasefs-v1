import {
  DRUG_ALIAS_LANGS,
  DRUG_IMPORT_STATUSES,
  DRUG_SOURCES,
  DRUG_STATUSES,
} from "@wasfa/shared/ai";
import { DRUG_LEARNED_STATUSES, DRUG_UNMATCHED_STATUSES } from "@wasfa/shared/drugs";
import { COUNTRY_CODE_PATTERN } from "@wasfa/shared/identity";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { users } from "./users.js";

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/*
 * The drug reference data behind matching. Platform data (no owner), imported from EDA / SFDA lists
 * through the admin wizard. Every imported row carries its batch, so a bad import can be rolled back
 * by batch; deleting a batch row only forgets the link (`SET NULL`). `normalized*` columns hold the
 * output of the shared Arabic/English normalizer and are what the trigram indexes search.
 * Strengths are stored as `value x 10^6` integers (`strength_value_micro`) plus a unit, never floats.
 */

export const drugImportBatches = pgTable(
  "drug_import_batches",
  {
    id: idColumn(),
    fileName: text().notNull(),
    source: text({ enum: DRUG_SOURCES }).notNull(),
    // Column mapping chosen in the wizard: source column -> our field.
    mapping: jsonb().notNull().default({}),
    rowsTotal: integer().notNull().default(0),
    rowsInserted: integer().notNull().default(0),
    rowsUpdated: integer().notNull().default(0),
    rowsSkipped: integer().notNull().default(0),
    status: text({ enum: DRUG_IMPORT_STATUSES }).notNull().default("draft"),
    committedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    committedAt: timestamp({ withTimezone: true }),
    rolledBackAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check("drug_import_batches_source_check", inList(table.source, DRUG_SOURCES)),
    check("drug_import_batches_status_check", inList(table.status, DRUG_IMPORT_STATUSES)),
    check(
      "drug_import_batches_counts_check",
      sql`${table.rowsTotal} >= 0 and ${table.rowsInserted} >= 0 and ${table.rowsUpdated} >= 0 and ${table.rowsSkipped} >= 0`,
    ),
  ],
);

export const activeIngredients = pgTable(
  "active_ingredients",
  {
    id: idColumn(),
    nameEn: text().notNull(),
    nameAr: text(),
    normalized: text().notNull().unique("active_ingredients_normalized_key"),
    importBatchId: uuid().references(() => drugImportBatches.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    index("active_ingredients_normalized_trgm_idx").using(
      "gin",
      sql`${table.normalized} gin_trgm_ops`,
    ),
  ],
);

export const drugs = pgTable(
  "drugs",
  {
    id: idColumn(),
    brandEn: text().notNull(),
    brandAr: text(),
    normalizedEn: text().notNull(),
    normalizedAr: text(),
    form: text(),
    strengthText: text(),
    strengthValueMicro: bigint({ mode: "number" }),
    strengthUnit: text(),
    manufacturer: text(),
    country: text(),
    status: text({ enum: DRUG_STATUSES }).notNull().default("active"),
    importBatchId: uuid().references(() => drugImportBatches.id, { onDelete: "set null" }),
    category: text(),
    // Integer minor units (AGENT 5.5): piastres for EGP. Null = no price known.
    priceMinor: integer(),
    oldPriceMinor: integer(),
    currency: text().notNull().default("EGP"),
    // The pack as printed ("20 f.c.tabs") and its unit count.
    packText: text(),
    unitsCount: integer(),
    barcode: text(),
    // Where a row came from (`dwaprices`) and its id there: re-imports upsert on the pair.
    source: text(),
    sourceRef: text(),
    // The brand family (normalized name without strength, form and pack), e.g. `flumox`.
    brandKey: text().notNull().default(""),
    priceUpdatedAt: timestamp({ withTimezone: true }),
    // Set by any admin edit: a re-import never overwrites such a row.
    adminEditedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check("drugs_status_check", inList(table.status, DRUG_STATUSES)),
    check(
      "drugs_country_check",
      sql`${table.country} is null or ${matches(table.country, COUNTRY_CODE_PATTERN.source)}`,
    ),
    check(
      "drugs_strength_check",
      sql`${table.strengthValueMicro} is null or ${table.strengthValueMicro} >= 0`,
    ),
    check("drugs_price_check", sql`${table.priceMinor} is null or ${table.priceMinor} >= 0`),
    check(
      "drugs_old_price_check",
      sql`${table.oldPriceMinor} is null or ${table.oldPriceMinor} >= 0`,
    ),
    check("drugs_currency_check", matches(table.currency, CURRENCY_PATTERN.source)),
    check("drugs_units_count_check", sql`${table.unitsCount} is null or ${table.unitsCount} > 0`),
    index("drugs_brand_key_idx").on(table.brandKey),
    index("drugs_barcode_idx").on(table.barcode),
    index("drugs_category_idx").on(table.category),
    uniqueIndex("drugs_source_ref_key")
      .on(table.source, table.sourceRef)
      .where(sql`${table.sourceRef} is not null`),
    index("drugs_brand_key_trgm_idx").using("gin", sql`${table.brandKey} gin_trgm_ops`),
    index("drugs_normalized_en_trgm_idx").using("gin", sql`${table.normalizedEn} gin_trgm_ops`),
    index("drugs_normalized_ar_trgm_idx").using("gin", sql`${table.normalizedAr} gin_trgm_ops`),
  ],
);

/** A drug's active ingredients with the strength of each (combination products have several). */
export const drugIngredients = pgTable(
  "drug_ingredients",
  {
    drugId: uuid()
      .notNull()
      .references(() => drugs.id, { onDelete: "cascade" }),
    ingredientId: uuid()
      .notNull()
      .references(() => activeIngredients.id, { onDelete: "cascade" }),
    strengthText: text(),
    strengthValueMicro: bigint({ mode: "number" }),
    strengthUnit: text(),
  },
  (table) => [
    primaryKey({ columns: [table.drugId, table.ingredientId], name: "drug_ingredients_pkey" }),
    // Alternatives and ingredient search go from an ingredient to its drugs.
    index("drug_ingredients_ingredient_idx").on(table.ingredientId),
    check(
      "drug_ingredients_strength_check",
      sql`${table.strengthValueMicro} is null or ${table.strengthValueMicro} >= 0`,
    ),
  ],
);

export const drugAliases = pgTable(
  "drug_aliases",
  {
    id: idColumn(),
    drugId: uuid()
      .notNull()
      .references(() => drugs.id, { onDelete: "cascade" }),
    alias: text().notNull(),
    normalized: text().notNull(),
    lang: text({ enum: DRUG_ALIAS_LANGS }).notNull(),
    source: text(),
    importBatchId: uuid().references(() => drugImportBatches.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("drug_aliases_drug_normalized_key").on(table.drugId, table.normalized),
    check("drug_aliases_lang_check", inList(table.lang, DRUG_ALIAS_LANGS)),
    index("drug_aliases_normalized_trgm_idx").using("gin", sql`${table.normalized} gin_trgm_ops`),
  ],
);

/** Readings nobody could match, counted so an admin can map the frequent ones. No user, no image. */
export const drugUnmatchedNames = pgTable(
  "drug_unmatched_names",
  {
    normalized: text().primaryKey(),
    // A reading as the model wrote it, never a user id or an image.
    sample: text().notNull(),
    hits: integer().notNull().default(1),
    firstSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
    status: text({ enum: DRUG_UNMATCHED_STATUSES }).notNull().default("open"),
    mappedDrugId: uuid().references(() => drugs.id, { onDelete: "set null" }),
  },
  (table) => [
    check("drug_unmatched_names_status_check", inList(table.status, DRUG_UNMATCHED_STATUSES)),
    check("drug_unmatched_names_hits_check", sql`${table.hits} >= 1`),
  ],
);

/** A user who corrected a line to a database drug: "this reading means this drug". */
export const drugLearningVotes = pgTable(
  "drug_learning_votes",
  {
    normalized: text().notNull(),
    drugId: uuid()
      .notNull()
      .references(() => drugs.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.normalized, table.drugId, table.userId],
      name: "drug_learning_votes_pkey",
    }),
  ],
);

/** Votes per (reading, drug); an approved pair becomes a `drug_aliases` row with source `learned`. */
export const drugLearned = pgTable(
  "drug_learned",
  {
    normalized: text().notNull(),
    drugId: uuid()
      .notNull()
      .references(() => drugs.id, { onDelete: "cascade" }),
    votes: integer().notNull().default(0),
    status: text({ enum: DRUG_LEARNED_STATUSES }).notNull().default("pending"),
    decidedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.normalized, table.drugId], name: "drug_learned_pkey" }),
    check("drug_learned_status_check", inList(table.status, DRUG_LEARNED_STATUSES)),
    check("drug_learned_votes_check", sql`${table.votes} >= 0`),
  ],
);

export type DrugImportBatch = typeof drugImportBatches.$inferSelect;
export type NewDrugImportBatch = typeof drugImportBatches.$inferInsert;
export type ActiveIngredient = typeof activeIngredients.$inferSelect;
export type NewActiveIngredient = typeof activeIngredients.$inferInsert;
export type Drug = typeof drugs.$inferSelect;
export type NewDrug = typeof drugs.$inferInsert;
export type DrugIngredient = typeof drugIngredients.$inferSelect;
export type NewDrugIngredient = typeof drugIngredients.$inferInsert;
export type DrugAlias = typeof drugAliases.$inferSelect;
export type NewDrugAlias = typeof drugAliases.$inferInsert;
export type DrugUnmatchedName = typeof drugUnmatchedNames.$inferSelect;
export type NewDrugUnmatchedName = typeof drugUnmatchedNames.$inferInsert;
export type DrugLearningVote = typeof drugLearningVotes.$inferSelect;
export type NewDrugLearningVote = typeof drugLearningVotes.$inferInsert;
export type DrugLearned = typeof drugLearned.$inferSelect;
export type NewDrugLearned = typeof drugLearned.$inferInsert;
