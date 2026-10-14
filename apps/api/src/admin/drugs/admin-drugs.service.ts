import { Injectable } from "@nestjs/common";
import { classifyMatch, drugColumns } from "@wasfa/shared/drugs";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { normalizeDrugName, parseStrength } from "@wasfa/shared/normalize";

import { DrugMatcher } from "../../drugs/matcher.js";

import { AdminDrugsRepo, type DrugPatch, type DrugRow } from "./admin-drugs.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { Drug } from "@wasfa/db";
import type { DrugMatchCandidate } from "@wasfa/shared/drugs";
import type {
  AddAliasInput,
  DrugSearchQuery,
  DrugView,
  MergeDrugsInput,
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
] as const;
export const DRUG_MERGE_AUDIT_FIELDS = [
  ...DRUG_AUDIT_FIELDS,
  "movedAliases",
  "movedIngredients",
] as const;
export const DRUG_ALIAS_AUDIT_FIELDS = ["brandEn", "alias", "lang"] as const;

const notFound = () => new AppError(ErrorCode.NOT_FOUND);
const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });

const auditFields = (drug: Drug) => ({
  brandEn: drug.brandEn,
  brandAr: drug.brandAr,
  form: drug.form,
  strengthText: drug.strengthText,
  manufacturer: drug.manufacturer,
  country: drug.country,
  status: drug.status,
});

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
    ingredients: row.ingredients,
    aliases: row.aliases,
    createdAt: drug.createdAt.toISOString(),
    updatedAt: drug.updatedAt.toISOString(),
  };
}

/** The drug browser: search with the same matcher the prescription pipeline uses, edit, alias, merge. */
@Injectable()
export class AdminDrugsService {
  constructor(
    private readonly repo: AdminDrugsRepo,
    private readonly matcher: DrugMatcher,
  ) {}

  async search(query: DrugSearchQuery) {
    const text = query.q?.trim() ?? "";
    if (text === "") {
      const rows = await this.repo.rows(await this.repo.recentIds(query.limit));
      return { items: rows.map((row) => ({ ...drugView(row), match: null })) };
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
        if (row === undefined) return [];
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
    };
  }

  async get(id: string): Promise<DrugView> {
    const row = await this.repo.row(id);
    if (!row) throw notFound();
    return drugView(row);
  }

  async update(id: string, input: UpdateDrugInput, audit: AuditScope): Promise<DrugView> {
    const current = await this.repo.row(id);
    if (!current) throw notFound();
    const cur = current.drug;

    const patch: DrugPatch = {};
    // The searchable columns are re-derived together, from the edited and the unchanged inputs.
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
      if (patch.normalizedEn === "") {
        throw new AppError(ErrorCode.VALIDATION_FAILED, {
          details: { reason: "name_empty", fields: ["brandEn"] },
        });
      }
    }
    if (input.manufacturer !== undefined) patch.manufacturer = input.manufacturer;
    if (input.country !== undefined) patch.country = input.country;
    if (input.status !== undefined) patch.status = input.status;

    const outcome = await this.repo.update(id, patch);
    if (outcome.kind === "not_found") throw notFound();
    audit.targetId = id;
    audit.before = auditFields(outcome.before);
    audit.after = auditFields(outcome.after);
    return await this.get(id);
  }

  async addAlias(id: string, input: AddAliasInput, audit: AuditScope): Promise<DrugView> {
    const row = await this.repo.row(id);
    if (!row) throw notFound();
    const normalized = normalizeDrugName(input.alias).name;
    if (normalized === "") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { reason: "name_empty", fields: ["alias"] },
      });
    }
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
}
