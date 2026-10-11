import {
  DRUG_ALIAS_LANGS,
  DRUG_IMPORT_STATUSES,
  DRUG_SOURCES,
  DRUG_STATUSES,
} from "@wasfa/shared/ai";
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
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { users } from "./users.js";

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
