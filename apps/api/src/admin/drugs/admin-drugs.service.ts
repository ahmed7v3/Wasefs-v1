import { Injectable } from "@nestjs/common";
import { decideMatch, type RankedCandidate } from "@wasfa/shared/drug-decision";
import { classifyMatch, drugColumns } from "@wasfa/shared/drugs";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { normalizeDrugName, parseStrength, strengthMicro } from "@wasfa/shared/normalize";

import { DrugMatcher } from "../../drugs/matcher.js";
import { SettingsService } from "../../settings/settings.service.js";

import {
  AdminDrugsRepo,
  type DrugFilter,
  type DrugPatch,
  type DrugRow,
  type IngredientValues,
} from "./admin-drugs.repo.js";
import { decodeDrugCursor, encodeDrugCursor } from "./drug-cursor.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { Drug, NewDrug } from "@wasfa/db";
import type { DrugMatchCandidate } from "@wasfa/shared/drugs";
import type {
  AddAliasInput,
  CreateDrugInput,
  DrugIngredientInput,
  DrugSandboxQuery,
  DrugSandboxResponse,
  DrugSearchQuery,
  DrugView,
  LearnedDecisionInput,
  LearnedItem,
  LearnedQuery,
  MapUnmatchedInput,
  MergeDrugsInput,
  UnmatchedItem,
  UnmatchedQuery,
  UpdateDrugInput,
} from "@wasfa/shared/schemas/admin-drugs";

/** Audit rows of drug changes carry the names and strengths, never ids (the redactor mangles digit runs). */
export const DRUG_AUDIT_FIELDS = [
  "brandEn",
  "brandAr",
  "form",
  "strengthText",
  "manufacturer",
  "country",
  "status",
  "category",
  "packText",
  "priceMinor",
  "oldPriceMinor",
  "currency",
] as const;
export const DRUG_MERGE_AUDIT_FIELDS = [
  ...DRUG_AUDIT_FIELDS,
  "movedAliases",
  "movedIngredients",
] as const;
export const DRUG_ALIAS_AUDIT_FIELDS = ["brandEn", "alias", "lang"] as const;
/** A queue decision records the drug's name and the reading, nothing else. */
export const DRUG_QUEUE_AUDIT_FIELDS = ["brandEn", "alias"] as const;

/** Most categories the filter list offers. */
const CATEGORY_LIMIT = 300;

const notFound = () => new AppError(ErrorCode.NOT_FOUND);
const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const invalid = (reason: string, field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason, fields: [field] } });

const auditFields = (drug: Drug) => ({
  brandEn: drug.brandEn,
  brandAr: drug.brandAr,
  form: drug.form,
  strengthText: drug.strengthText,
  manufacturer: drug.manufacturer,
  country: drug.country,
  status: drug.status,
  category: drug.category,
  packText: drug.packText,
  priceMinor: drug.priceMinor,
  oldPriceMinor: drug.oldPriceMinor,
  currency: drug.currency,
});

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function drugView(row: DrugRow): DrugView {
  const { drug } = row;
  return {
    id: drug.id,
    brandEn: drug.brandEn,
    brandAr: drug.brandAr,
    form: drug.form,
    strengthText: drug.strengthText,
    strengthValueMicro: drug.strengthValueMicro,
    strengthUnit: drug.strengthUnit,
    manufacturer: drug.manufacturer,
    country: drug.country,
    status: drug.status,
    importBatchId: drug.importBatchId,
    category: drug.category,
    packText: drug.packText,
    unitsCount: drug.unitsCount,
    barcode: drug.barcode,
    priceMinor: drug.priceMinor,
    oldPriceMinor: drug.oldPriceMinor,
    currency: drug.currency,
    brandKey: drug.brandKey,
    source: drug.source,
    priceUpdatedAt: iso(drug.priceUpdatedAt),
    adminEditedAt: iso(drug.adminEditedAt),
    ingredients: row.ingredients,
    aliases: row.aliases,
    createdAt: drug.createdAt.toISOString(),
    updatedAt: drug.updatedAt.toISOString(),
  };
}

/** An ingredient typed by an admin as the rows the database stores (same shape the import writes). */
export function ingredientValues(input: DrugIngredientInput): IngredientValues {
  const nameEn = input.name.trim().replace(/\s+/g, " ");
  const parsed = normalizeDrugName(nameEn);
  if (parsed.name === "") throw invalid("name_empty", "ingredients");
  const strengthText = input.strength?.trim() || null;
  const strength = strengthText === null ? null : parseStrength(strengthText);
  return {
    nameEn,
    nameAr: parsed.lang === "ar" ? nameEn : null,
    normalized: parsed.name,
    strengthText,
    strengthValueMicro: strength === null ? null : strengthMicro(strength.value),
    strengthUnit: strength?.unit ?? null,
  };
}

/** The list filters applied to a row already loaded (the matcher's candidates are not filtered in SQL). */
function passes(row: DrugRow, filter: DrugFilter): boolean {
  const { drug } = row;
  if (filter.category !== undefined && drug.category !== filter.category) return false;
  if (filter.manufacturer !== undefined && drug.manufacturer !== filter.manufacturer) return false;
  if (filter.status !== undefined && drug.status !== filter.status) return false;
  if (filter.edited !== undefined && (drug.adminEditedAt !== null) !== filter.edited) return false;
  if (filter.missing === "ingredient" && row.ingredients.length > 0) return false;
  if (filter.missing === "price" && drug.priceMinor !== null) return false;
  if (filter.missing === "category" && (drug.category ?? "") !== "") return false;
  return true;
}

/** The drug browser: search with the same matcher the prescription pipeline uses, edit, alias, merge. */
@Injectable()
export class AdminDrugsService {
  constructor(
    private readonly repo: AdminDrugsRepo,
    private readonly matcher: DrugMatcher,
    private readonly settings: SettingsService,
  ) {}

  /**
   * What the recognition engine would do with a name, under the stored `medications` settings: the
   * matcher's candidates and `decideMatch`'s verdict, exactly as a prescription line gets them
   * (the candidates come from the primary reading). It ignores the `enabled` / `mode` switches on
   * purpose, so an admin can tune thresholds while recognition is off; the response reports them.
   */
  async sandbox(query: DrugSandboxQuery): Promise<DrugSandboxResponse> {
    const settings = await this.settings.get("medications");
    const strength = query.strength === undefined ? null : parseStrength(query.strength);
    const found = await this.matcher.matchDrug(query.q, {
      strength,
      form: query.form ?? null,
      limit: settings.maxCandidates,
      similarityFloor: settings.similarityFloor,
      strengthBonus: settings.strengthBonus,
      strengthConflictPenalty: settings.strengthConflictPenalty,
      formBonus: settings.formBonus,
    });
    const candidates: RankedCandidate[] = found.map((candidate) => ({
      ...candidate,
      via: "primary",
    }));
    const decision = decideMatch(
      {
        candidates,
        legibility: query.legibility,
        strengthWritten: query.strength !== undefined && query.strength !== "",
      },
      settings,
    );
    return {
      settings: {
        acceptScore: settings.acceptScore,
        reviewScore: settings.reviewScore,
        minMargin: settings.minMargin,
        enabled: settings.enabled,
        mode: settings.mode,
      },
      candidates: candidates.map((candidate) => ({
        drugId: candidate.drugId,
        brandEn: candidate.brandEn,
        brandAr: candidate.brandAr,
        brandKey: candidate.brandKey,
        strengthText: candidate.strengthText,
        form: candidate.form,
        score: candidate.score,
        explanation: candidate.explanation,
      })),
      decision: {
        matchClass: decision.matchClass,
        chosenDrugId: decision.chosen?.drugId ?? null,
        familyOnly: decision.familyOnly,
        reason: decision.reason,
      },
    };
  }

  async search(query: DrugSearchQuery) {
    const text = query.q?.trim() ?? "";
    const filter: DrugFilter = {
      category: query.category,
      manufacturer: query.manufacturer,
      missing: query.missing,
      status: query.status,
      edited: query.edited,
    };
    if (text === "") {
      const offset = decodeDrugCursor(query.cursor);
      const ids = await this.repo.listIds(filter, query.limit, offset);
      const rows = await this.repo.rows(ids.slice(0, query.limit));
      return {
        items: rows.map((row) => ({ ...drugView(row), match: null })),
        nextCursor: ids.length > query.limit ? encodeDrugCursor(offset + query.limit) : null,
      };
    }
    const candidates = await this.matcher.matchDrug(text, {
      strength: query.strength === undefined ? null : parseStrength(query.strength),
      form: query.form ?? null,
      limit: query.limit,
    });
    const rows = await this.repo.rows(candidates.map((candidate) => candidate.drugId));
    const byId = new Map(rows.map((row) => [row.drug.id, row]));
    return {
      items: candidates.flatMap((candidate: DrugMatchCandidate) => {
        const row = byId.get(candidate.drugId);
        if (row === undefined || !passes(row, filter)) return [];
        return [
          {
            ...drugView(row),
            match: {
              score: candidate.score,
              class: classifyMatch(candidate),
              explanation: candidate.explanation,
            },
          },
        ];
      }),
      nextCursor: null,
    };
  }

  async categories() {
    return { items: await this.repo.categories(CATEGORY_LIMIT) };
  }

  async get(id: string): Promise<DrugView> {
    const row = await this.repo.row(id);
    if (!row) throw notFound();
    return drugView(row);
  }

  async create(input: CreateDrugInput, audit: AuditScope): Promise<DrugView> {
    const columns = drugColumns({
      brandEn: input.brandEn,
      brandAr: input.brandAr,
      form: input.form,
      strengthText: input.strengthText,
    });
    if (columns.normalizedEn === "") throw invalid("name_empty", "brandEn");
    const ingredients = (input.ingredients ?? []).map(ingredientValues);
    const values: NewDrug = {
      ...columns,
      manufacturer: input.manufacturer ?? null,
      country: input.country ?? null,
      category: input.category ?? null,
      packText: input.packText ?? null,
      unitsCount: input.unitsCount ?? null,
      barcode: input.barcode ?? null,
      priceMinor: input.priceMinor ?? null,
      oldPriceMinor: input.oldPriceMinor ?? null,
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      priceUpdatedAt:
        input.priceMinor === undefined || input.priceMinor === null ? null : new Date(),
      source: "manual",
    };
    const drug = await this.repo.create(values, ingredients);
    audit.targetId = drug.id;
    audit.after = auditFields(drug);
    return await this.get(drug.id);
  }

  async update(id: string, input: UpdateDrugInput, audit: AuditScope): Promise<DrugView> {
    const current = await this.repo.row(id);
    if (!current) throw notFound();
    const cur = current.drug;

    const patch: DrugPatch = {};
    // The searchable columns (and the brand family key) are re-derived together, from the edited
    // and the unchanged inputs.
    if (
      input.brandEn !== undefined ||
      input.brandAr !== undefined ||
      input.form !== undefined ||
      input.strengthText !== undefined
    ) {
      Object.assign(
        patch,
        drugColumns({
          brandEn: input.brandEn ?? cur.brandEn,
          brandAr: input.brandAr === undefined ? cur.brandAr : input.brandAr,
          form: input.form === undefined ? cur.form : input.form,
          strengthText: input.strengthText === undefined ? cur.strengthText : input.strengthText,
        }),
      );
      if (patch.normalizedEn === "") throw invalid("name_empty", "brandEn");
    }
    if (input.manufacturer !== undefined) patch.manufacturer = input.manufacturer;
    if (input.country !== undefined) patch.country = input.country;
    if (input.status !== undefined) patch.status = input.status;
    if (input.category !== undefined) patch.category = input.category;
    if (input.packText !== undefined) patch.packText = input.packText;
    if (input.unitsCount !== undefined) patch.unitsCount = input.unitsCount;
    if (input.barcode !== undefined) patch.barcode = input.barcode;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.oldPriceMinor !== undefined) patch.oldPriceMinor = input.oldPriceMinor;
    if (input.priceMinor !== undefined) {
      patch.priceMinor = input.priceMinor;
      // The price is the admin's now; when it was set is what users see as "updated".
      patch.priceUpdatedAt = new Date();
    }
    const ingredients = input.ingredients?.map(ingredientValues);

    const outcome = await this.repo.update(id, patch, ingredients);
    if (outcome.kind === "not_found") throw notFound();
    audit.targetId = id;
    audit.before = auditFields(outcome.before);
    audit.after = auditFields(outcome.after);
    return await this.get(id);
  }

  /** Withdraw or restore: a withdrawn drug stays in the database but leaves search and recognition. */
  setStatus(id: string, status: Drug["status"], audit: AuditScope): Promise<DrugView> {
    return this.update(id, { status }, audit);
  }

  /** Hard delete. Prescription results keep their own snapshot of what was matched. */
  async remove(id: string, audit: AuditScope): Promise<{ deleted: true }> {
    const removed = await this.repo.remove(id);
    if (!removed) throw notFound();
    audit.targetId = id;
    audit.before = auditFields(removed);
    return { deleted: true };
  }

  async addAlias(id: string, input: AddAliasInput, audit: AuditScope): Promise<DrugView> {
    const row = await this.repo.row(id);
    if (!row) throw notFound();
    const normalized = normalizeDrugName(input.alias).name;
    if (normalized === "") throw invalid("name_empty", "alias");
    const lang = input.lang ?? normalizeDrugName(input.alias).lang;
    // The drug already answers to its own names.
    if (normalized === row.drug.normalizedEn || normalized === row.drug.normalizedAr) {
      throw conflict("alias_exists");
    }
    const outcome = await this.repo.addAlias({
      drugId: id,
      alias: input.alias,
      normalized,
      lang,
      source: "admin",
    });
    if (outcome.kind === "not_found") throw notFound();
    if (outcome.kind === "exists") throw conflict("alias_exists");
    audit.targetId = id;
    audit.after = { brandEn: row.drug.brandEn, alias: input.alias, lang };
    return await this.get(id);
  }

  async merge(input: MergeDrugsInput, audit: AuditScope) {
    const outcome = await this.repo.merge(input.keepId, input.mergeId);
    if (outcome.kind === "not_found") throw notFound();
    audit.targetId = input.keepId;
    audit.before = auditFields(outcome.merged);
    audit.after = {
      ...auditFields(outcome.kept),
      movedAliases: outcome.movedAliases,
      movedIngredients: outcome.movedIngredients,
    };
    return {
      kept: await this.get(input.keepId),
      movedAliases: outcome.movedAliases,
      movedIngredients: outcome.movedIngredients,
    };
  }

  // --- Review queues (docs/MEDICATIONS.md section 7) ---

  /** Readings nobody could match, the most frequent first. */
  async unmatched(query: UnmatchedQuery) {
    const offset = decodeDrugCursor(query.cursor);
    const rows = await this.repo.unmatched(query.status, query.limit, offset);
    const items: UnmatchedItem[] = rows.slice(0, query.limit).map((row) => ({
      normalized: row.normalized,
      sample: row.sample,
      hits: row.hits,
      firstSeen: row.firstSeen.toISOString(),
      lastSeen: row.lastSeen.toISOString(),
      status: row.status,
      mappedDrugId: row.mappedDrugId,
      mappedBrandEn: row.mappedBrandEn,
    }));
    return {
      items,
      nextCursor: rows.length > query.limit ? encodeDrugCursor(offset + query.limit) : null,
    };
  }

  /** Teaches the engine that this reading is that drug: an alias with source `admin`. */
  async mapUnmatched(
    normalized: string,
    input: MapUnmatchedInput,
    adminId: string,
    audit: AuditScope,
  ): Promise<{ ok: true }> {
    const [entry, drug] = await Promise.all([
      this.repo.findUnmatched(normalized),
      this.repo.row(input.drugId),
    ]);
    if (!entry || !drug) throw notFound();
    await this.repo.promote({
      normalized: entry.normalized,
      drugId: input.drugId,
      decidedBy: adminId,
      source: "admin",
    });
    audit.targetId = input.drugId;
    audit.after = { brandEn: drug.drug.brandEn, alias: entry.normalized };
    return { ok: true };
  }

  async ignoreUnmatched(normalized: string, audit: AuditScope): Promise<{ ok: true }> {
    if (!(await this.repo.ignoreUnmatched(normalized))) throw notFound();
    audit.after = { alias: normalized };
    return { ok: true };
  }

  /** Alias candidates users voted for. */
  async learned(query: LearnedQuery) {
    const offset = decodeDrugCursor(query.cursor);
    const rows = await this.repo.learned(query.status, query.limit, offset);
    const items: LearnedItem[] = rows.slice(0, query.limit).map((row) => ({
      normalized: row.learned.normalized,
      drugId: row.learned.drugId,
      brandEn: row.brandEn,
      strengthText: row.strengthText,
      form: row.form,
      votes: row.learned.votes,
      status: row.learned.status,
      decidedAt: iso(row.learned.decidedAt),
    }));
    return {
      items,
      nextCursor: rows.length > query.limit ? encodeDrugCursor(offset + query.limit) : null,
    };
  }

  async approveLearned(
    input: LearnedDecisionInput,
    adminId: string,
    audit: AuditScope,
  ): Promise<{ ok: true }> {
    const [pair, drug] = await Promise.all([
      this.repo.findLearned(input.normalized, input.drugId),
      this.repo.row(input.drugId),
    ]);
    if (!pair || !drug) throw notFound();
    await this.repo.promote({
      normalized: pair.normalized,
      drugId: pair.drugId,
      decidedBy: adminId,
      source: "learned",
    });
    audit.targetId = pair.drugId;
    audit.after = { brandEn: drug.drug.brandEn, alias: pair.normalized };
    return { ok: true };
  }

  async rejectLearned(
    input: LearnedDecisionInput,
    adminId: string,
    audit: AuditScope,
  ): Promise<{ ok: true }> {
    const [pair, drug] = await Promise.all([
      this.repo.findLearned(input.normalized, input.drugId),
      this.repo.row(input.drugId),
    ]);
    if (!pair || !drug) throw notFound();
    await this.repo.rejectLearned(pair.normalized, pair.drugId, adminId);
    audit.targetId = pair.drugId;
    audit.after = { brandEn: drug.drug.brandEn, alias: pair.normalized };
    return { ok: true };
  }
}
