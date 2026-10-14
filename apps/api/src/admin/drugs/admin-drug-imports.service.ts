import { basename } from "node:path";

import { Injectable } from "@nestjs/common";
import { DRUG_IMPORT_MAX_BYTES } from "@wasfa/shared/drugs";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  createImportFieldsSchema,
  importMappingSchema,
  type DryRunInput,
  type ImportView,
  type RollbackResult,
} from "@wasfa/shared/schemas/admin-drugs";

import { parseWithSchema } from "../../common/validation.js";

import { AdminDrugImportsRepo } from "./admin-drug-imports.repo.js";
import { DrugImportStore } from "./drug-import.store.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { DrugImportBatch } from "@wasfa/db";
import type { FastifyRequest } from "fastify";
import "@fastify/multipart";

/** Fields kept in the audit rows of imports. No ids: the audit redactor mangles digit runs. */
export const DRUG_IMPORT_AUDIT_FIELDS = [
  "fileName",
  "source",
  "rowsTotal",
  "rowsInserted",
  "rowsUpdated",
  "rowsSkipped",
  "deletedDrugs",
  "untaggedDrugs",
  "deletedIngredients",
  "deletedAliases",
] as const;

type ImportSummary = Omit<ImportView, "report" | "progress" | "fileAvailable">;

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const FILE_NAME_MAX = 200;
const LIST_LIMIT = 50;

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const invalid = (reason: string, field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason, fields: [field] } });

/** An Excel workbook (zip) or something that starts like JSON; the worker decides if it really parses. */
function looksSupported(bytes: Buffer): boolean {
  if (bytes.subarray(0, 4).equals(XLSX_MAGIC)) return true;
  const text = bytes.subarray(0, 64).toString("utf8");
  const head = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart();
  return head.startsWith("[") || head.startsWith("{");
}

function safeFileName(name: string): string {
  const cleaned = basename(name.replaceAll("\\", "/"))
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(-FILE_NAME_MAX);
  return cleaned === "" ? "upload" : cleaned;
}

interface Upload {
  fields: Record<string, string>;
  file: { name: string; bytes: Buffer };
}

/** Reads the multipart body: text fields and exactly one file of at most 20 MB. */
async function readUpload(request: FastifyRequest): Promise<Upload> {
  if (!request.isMultipart()) throw invalid("not_multipart", "file");
  const fields: Record<string, string> = {};
  let file: Upload["file"] | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || file !== undefined) throw invalid("one_file_only", "file");
        file = { name: part.filename, bytes: await part.toBuffer() };
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw invalid("file_too_large", "file");
    if (typeof code === "string" && code.startsWith("FST_")) throw invalid("bad_upload", "file");
    throw error;
  }
  if (file === undefined || file.bytes.length === 0) throw invalid("file_required", "file");
  return { fields, file };
}

/** The import wizard's API: upload, dry run, commit (queued for the worker) and rollback. */
@Injectable()
export class AdminDrugImportsService {
  constructor(
    private readonly repo: AdminDrugImportsRepo,
    private readonly store: DrugImportStore,
  ) {}

  async list(): Promise<{ items: ImportSummary[] }> {
    const rows = await this.repo.list(LIST_LIMIT);
    return { items: rows.map((row) => this.summary(row)) };
  }

  async get(id: string): Promise<ImportView> {
    return await this.view(await this.mustFind(id));
  }

  /** Stores the upload and starts the first dry run with the source's preset (or the given mapping). */
  async create(request: FastifyRequest, actorId: string, audit: AuditScope): Promise<ImportView> {
    const { fields, file } = await readUpload(request);
    const parsed = parseWithSchema(createImportFieldsSchema, {
      source: fields.source,
      mapping: fields.mapping,
    });
    if (file.bytes.length > DRUG_IMPORT_MAX_BYTES) throw invalid("file_too_large", "file");
    if (!looksSupported(file.bytes)) throw invalid("unsupported_file", "file");

    const batch = await this.repo.create({
      fileName: safeFileName(file.name),
      source: parsed.source,
      // Empty means "the source's preset": the worker resolves it against the file's headers.
      mapping: parsed.mapping ?? {},
    });
    audit.targetId = batch.id;
    audit.after = { fileName: batch.fileName, source: batch.source };
    await this.store.putFile(batch.id, file.bytes);
    await this.enqueue(batch.id, "dry_run", actorId);
    return await this.view(batch);
  }

  async dryRun(id: string, input: DryRunInput, actorId: string): Promise<ImportView> {
    const batch = await this.mustFind(id);
    this.requireOpen(batch);
    await this.requireFile(id);
    await this.enqueue(id, "dry_run", actorId, async () => {
      if (input.mapping !== undefined) await this.repo.setMapping(id, input.mapping);
    });
    return await this.get(id);
  }

  async commit(id: string, actorId: string, audit: AuditScope): Promise<ImportView> {
    const batch = await this.mustFind(id);
    this.requireOpen(batch);
    // Only a mapping that passed a dry run may be committed: the report the admin read is what happens.
    if (batch.status !== "dry_run") throw conflict("dry_run_required");
    await this.requireFile(id);
    await this.enqueue(id, "commit", actorId);
    audit.targetId = id;
    audit.after = { fileName: batch.fileName, source: batch.source, rowsTotal: batch.rowsTotal };
    return await this.get(id);
  }

  async rollback(id: string, audit: AuditScope): Promise<RollbackResult> {
    const batch = await this.mustFind(id);
    if (batch.status !== "committed") throw conflict("not_committed");
    // A commit that is still running (a repeat of an interrupted one) must finish first.
    if (await this.store.isBusy(id)) throw conflict("busy");
    const outcome = await this.repo.rollback(id);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "not_committed") throw conflict("not_committed");
    const counts: RollbackResult = {
      deletedDrugs: outcome.deletedDrugs,
      untaggedDrugs: outcome.untaggedDrugs,
      deletedIngredients: outcome.deletedIngredients,
      deletedAliases: outcome.deletedAliases,
    };
    audit.targetId = id;
    audit.before = { fileName: batch.fileName, source: batch.source };
    audit.after = {
      fileName: batch.fileName,
      source: batch.source,
      rowsInserted: batch.rowsInserted,
      rowsUpdated: batch.rowsUpdated,
      ...counts,
    };
    return counts;
  }

  private async mustFind(id: string): Promise<DrugImportBatch> {
    const batch = await this.repo.find(id);
    if (!batch) throw new AppError(ErrorCode.NOT_FOUND);
    return batch;
  }

  /** A finished import cannot be run again. */
  private requireOpen(batch: DrugImportBatch): void {
    if (batch.status === "committed" || batch.status === "rolled_back") {
      throw conflict(`already_${batch.status}`);
    }
  }

  private async requireFile(id: string): Promise<void> {
    if (!(await this.store.hasFile(id))) throw conflict("file_expired");
  }

  /** Takes the batch's lock, prepares, and queues the job; the lock is let go if anything fails. */
  private async enqueue(
    id: string,
    mode: "dry_run" | "commit",
    actorId: string,
    prepare?: () => Promise<void>,
  ): Promise<void> {
    if (!(await this.store.tryLock(id))) throw conflict("busy");
    try {
      await prepare?.();
      await this.store.start(id, mode, actorId);
    } catch (error) {
      await this.store.unlock(id);
      throw error;
    }
  }

  private summary(batch: DrugImportBatch): ImportSummary {
    const mapping = importMappingSchema.safeParse(batch.mapping);
    return {
      id: batch.id,
      fileName: batch.fileName,
      source: batch.source,
      mapping: mapping.success ? mapping.data : {},
      status: batch.status,
      rowsTotal: batch.rowsTotal,
      rowsInserted: batch.rowsInserted,
      rowsUpdated: batch.rowsUpdated,
      rowsSkipped: batch.rowsSkipped,
      committedAt: batch.committedAt?.toISOString() ?? null,
      rolledBackAt: batch.rolledBackAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  private async view(batch: DrugImportBatch): Promise<ImportView> {
    const [progress, report, fileAvailable] = await Promise.all([
      this.store.progress(batch.id),
      this.store.report(batch.id),
      this.store.hasFile(batch.id),
    ]);
    return { ...this.summary(batch), progress, report, fileAvailable };
  }
}
