import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { Injectable } from "@nestjs/common";
import { skillVersion } from "@wasfa/ai";
import { MEDICAL_AI_TASKS } from "@wasfa/shared/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  evalExpectedSchema,
  evalImageKey,
  evalItemScoreSchema,
  evalRunMetricsSchema,
  evalStagingKey,
  type EvalExpected,
} from "@wasfa/shared/evals";
import { redactText } from "@wasfa/shared/redact";
import { RX_SKILL_NAME } from "@wasfa/shared/rx";
import { routeModelParamsSchema } from "@wasfa/shared/schemas/admin-ai";
import {
  EVAL_IMPORT_MAX_IMAGES,
  EVAL_IMPORT_SHEET_MAX_BYTES,
  evalImportFieldsSchema,
  evalRouteSnapshotSchema,
  type ApproveCorrectionInput,
  type EvalCompareResponse,
  type EvalImportReport,
  type EvalItemDetail,
  type EvalRouteSnapshot,
  type EvalRunDetail,
  type EvalRunSummary,
  type EvalSetView,
  type ReviewQueueItem,
  type StartEvalRunInput,
} from "@wasfa/shared/schemas/admin-evals";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";
import { rxResultSchema } from "@wasfa/shared/schemas/rx";

import { parseWithSchema } from "../../common/validation.js";
import { ObjectStorage } from "../../files/object-storage.js";

import { AdminEvalsRepo, type ItemResultRow, type RunRow } from "./admin-evals.repo.js";
import { EvalsQueue } from "./evals-queue.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { FastifyRequest } from "fastify";
import "@fastify/multipart";

/** Fields kept in the audit rows of evaluation changes. Names and counts, no ids. */
export const EVAL_AUDIT_FIELDS = [
  "set",
  "runs",
  "models",
  "images",
  "kind",
  "imageCopied",
  "consent",
  "status",
] as const;

const REVIEW_QUEUE_LIMIT = 100;
const FILE_NAME_MAX = 200;

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const invalid = (reason: string, field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason, fields: [field] } });
const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const IMAGE_MAGIC: readonly number[][] = [
  [0xff, 0xd8, 0xff],
  [0x89, 0x50, 0x4e, 0x47],
  [0x25, 0x50, 0x44, 0x46],
];
const startsWith = (bytes: Buffer, magic: readonly number[]): boolean =>
  magic.every((byte, i) => bytes[i] === byte);
/** JPEG, PNG, PDF by their first bytes; WebP is `RIFF....WEBP`. The worker decides if it really decodes. */
const looksLikeImage = (bytes: Buffer): boolean =>
  IMAGE_MAGIC.some((magic) => startsWith(bytes, magic)) ||
  (bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP");

function safeName(name: string): string {
  const cleaned = basename(name.replaceAll("\\", "/"))
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(-FILE_NAME_MAX);
  return cleaned === "" ? "upload" : cleaned;
}

interface ImportUpload {
  fields: Record<string, string>;
  sheet: Buffer;
  images: { name: string; bytes: Buffer }[];
}

/** Reads the multipart body: text fields, one `sheet` and up to 300 `images`, each at most 10 MB. */
async function readImportUpload(request: FastifyRequest): Promise<ImportUpload> {
  if (!request.isMultipart()) throw invalid("not_multipart", "sheet");
  const fields: Record<string, string> = {};
  let sheet: Buffer | undefined;
  const images: ImportUpload["images"] = [];
  try {
    for await (const part of request.parts({
      limits: {
        fileSize: UPLOAD_MAX_BYTES,
        files: EVAL_IMPORT_MAX_IMAGES + 1,
        fields: 5,
        fieldSize: 20_000,
        parts: EVAL_IMPORT_MAX_IMAGES + 10,
      },
    })) {
      if (part.type === "file") {
        const bytes = await part.toBuffer();
        if (part.fieldname === "sheet" && sheet === undefined) sheet = bytes;
        else if (part.fieldname === "images") images.push({ name: safeName(part.filename), bytes });
        else throw invalid("unexpected_file", part.fieldname);
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "FST_REQ_FILE_TOO_LARGE") throw invalid("file_too_large", "images");
    if (code === "FST_FILES_LIMIT") throw invalid("too_many_images", "images");
    if (typeof code === "string" && code.startsWith("FST_")) throw invalid("bad_upload", "sheet");
    throw error;
  }
  if (sheet === undefined || sheet.length === 0) throw invalid("sheet_required", "sheet");
  return { fields, sheet, images };
}

function summaryOf(row: RunRow): EvalRunSummary {
  const snapshot = evalRouteSnapshotSchema.safeParse(row.run.routeSnapshot);
  const metrics = evalRunMetricsSchema.safeParse(row.run.metrics);
  const data = snapshot.success ? snapshot.data : null;
  return {
    id: row.run.id,
    setId: row.run.setId,
    setKey: row.setKey,
    setName: row.setName,
    status: row.run.status,
    snapshot: data,
    modelName:
      data?.models.find((model) => model.modelId === data.primaryModelId)?.displayName ?? null,
    metrics: metrics.success ? metrics.data : null,
    costUsdMicros: row.run.costUsdMicros,
    itemsTotal: row.itemsTotal,
    itemsDone: row.itemsDone,
    startedBy: row.run.startedBy,
    createdAt: row.run.createdAt.toISOString(),
    startedAt: iso(row.run.startedAt),
    finishedAt: iso(row.run.finishedAt),
  };
}

const expectedCount = (item: ItemResultRow["item"]): number => {
  const parsed = evalExpectedSchema.safeParse(item.expected);
  return parsed.success ? parsed.data.items.length : 0;
};

function itemRow(row: ItemResultRow) {
  const scores = evalItemScoreSchema.safeParse(row.scores);
  return {
    itemId: row.item.id,
    kind: row.item.kind,
    expected: expectedCount(row.item),
    scores: scores.success ? scores.data : null,
    costUsdMicros: row.costUsdMicros ?? 0,
    latencyMs: row.latencyMs,
    error: row.error,
    done: row.done,
  };
}

/** Accuracy evaluation of prescription reading (Task 2.10): label sets, runs, comparison, review queue. */
@Injectable()
export class AdminEvalsService {
  constructor(
    private readonly repo: AdminEvalsRepo,
    private readonly queue: EvalsQueue,
    private readonly storage: ObjectStorage,
  ) {}

  // --- Sets and import ---

  async sets(): Promise<{ items: EvalSetView[] }> {
    const rows = await this.repo.listSets();
    return {
      items: rows.map((row) => ({
        id: row.set.id,
        key: row.set.key,
        name: row.set.name,
        description: row.set.description,
        items: row.items,
        printed: row.printed,
        handwritten: row.handwritten,
        withoutImage: row.withoutImage,
        createdAt: row.set.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Parks the label sheet and the images in object storage (private `evals/rx/staging/`) and queues
   * the import; the worker processes the images (EXIF stripped) and writes the eval rows.
   */
  async startImport(
    request: FastifyRequest,
    actorId: string,
    audit: AuditScope,
  ): Promise<{ id: string }> {
    if (!this.storage.configured) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
        details: { reason: "storage_not_configured" },
      });
    }
    const upload = await readImportUpload(request);
    const fields = parseWithSchema(evalImportFieldsSchema, {
      key: upload.fields.key,
      name: upload.fields.name,
      description: upload.fields.description,
    });
    if (upload.sheet.length > EVAL_IMPORT_SHEET_MAX_BYTES) throw invalid("file_too_large", "sheet");
    if (!startsWith(upload.sheet, ZIP)) throw invalid("unsupported_sheet", "sheet");
    const names = new Set<string>();
    for (const image of upload.images) {
      if (!looksLikeImage(image.bytes)) throw invalid("unsupported_image", "images");
      const key = image.name.toLowerCase();
      if (names.has(key)) throw invalid("duplicate_image_name", "images");
      names.add(key);
    }

    const batchId = randomUUID();
    await this.storage.put(
      evalStagingKey(batchId, "sheet.xlsx"),
      upload.sheet,
      "application/octet-stream",
    );
    for (const [index, image] of upload.images.entries()) {
      await this.storage.put(
        evalStagingKey(batchId, `img-${String(index)}`),
        image.bytes,
        "application/octet-stream",
      );
    }
    await this.queue.startImport({
      batchId,
      setKey: fields.key,
      setName: fields.name,
      description: fields.description ?? null,
      actorId,
      images: upload.images.map((image) => image.name),
    });
    audit.targetId = batchId;
    audit.after = { set: fields.key, images: upload.images.length };
    return { id: batchId };
  }

  async importReport(id: string): Promise<EvalImportReport> {
    const report = await this.queue.report(id);
    if (report === null) throw new AppError(ErrorCode.NOT_FOUND);
    return report;
  }

  // --- Runs ---

  /**
   * One run per compared model (or one on the route as configured). The run records what it used:
   * the route version and the exact models with their params, so its scores stay meaningful after
   * the route changes. A compared model replaces the route's primary and runs alone: a comparison
   * must not be blurred by fallbacks.
   */
  async startRuns(
    input: StartEvalRunInput,
    actorId: string,
    audit: AuditScope,
  ): Promise<{ items: EvalRunSummary[] }> {
    const set = await this.repo.findSet(input.setId);
    if (set === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if ((await this.repo.runnableItems(set.id)) === 0) throw conflict("empty_set");

    const route = await this.repo.defaultRoute("rx_extract", input.mode);
    if (route === undefined || route.models.length === 0) throw conflict("no_route");
    const primaryEntry = route.models[0];
    if (primaryEntry === undefined) throw conflict("no_route");

    const wanted =
      input.modelIds.length === 0 ? route.models.map((m) => m.modelId) : input.modelIds;
    const found = await this.repo.modelsByIds([...new Set(wanted)]);
    const byId = new Map(found.map((row) => [row.model.id, row]));

    const entries = (
      input.modelIds.length === 0
        ? route.models
        : input.modelIds.map((modelId) => ({ modelId, params: primaryEntry.params }))
    ).map((entry) => ({ modelId: entry.modelId, params: entry.params }));

    const snapshots: EvalRouteSnapshot[] = [];
    const lists = input.modelIds.length === 0 ? [entries] : entries.map((entry) => [entry]);
    for (const list of lists) {
      const models = list.map((entry) => {
        const row = byId.get(entry.modelId);
        if (row === undefined) throw invalid("unknown_model", "modelIds");
        if (input.modelIds.length > 0) {
          if (!row.model.enabled || !row.provider.enabled)
            throw invalid("model_disabled", "modelIds");
          if (!["vision", "json"].every((c) => (row.model.capabilities as string[]).includes(c))) {
            throw invalid("missing_capability", "modelIds");
          }
          if (MEDICAL_AI_TASKS.has("rx_extract") && row.provider.dataPolicy === "free_tier") {
            throw invalid("free_tier_medical", "modelIds");
          }
        }
        const params = routeModelParamsSchema.safeParse(entry.params);
        return {
          modelId: row.model.id,
          model: row.model.modelId,
          displayName: row.model.displayName,
          providerKey: row.provider.key,
          params: params.success ? params.data : {},
        };
      });
      const first = models[0];
      if (first === undefined) throw conflict("no_route");
      snapshots.push({
        task: "rx_extract",
        mode: input.mode,
        routeId: route.id,
        routeVersion: route.version,
        comparedModelId: input.modelIds.length === 0 ? null : first.modelId,
        models,
        primaryModelId: first.modelId,
        skillVersion: skillVersion(RX_SKILL_NAME),
      });
    }

    const ids = await this.repo.createRuns(
      snapshots.map((snapshot) => ({
        setId: set.id,
        routeSnapshot: snapshot,
        startedBy: actorId,
      })),
    );
    try {
      for (const id of ids) await this.queue.startRun(id);
    } catch (error) {
      await this.repo.failRuns(ids);
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause: error });
    }
    if (ids[0] !== undefined) audit.targetId = ids[0];
    audit.after = {
      set: set.key,
      runs: ids.length,
      models: snapshots.map((s) => s.models[0]?.displayName ?? ""),
    };
    const rows = await Promise.all(ids.map((id) => this.repo.findRun(id)));
    return { items: rows.flatMap((row) => (row === undefined ? [] : [summaryOf(row)])) };
  }

  async runs(query: {
    setId?: string | undefined;
    limit: number;
  }): Promise<{ items: EvalRunSummary[] }> {
    const rows = await this.repo.listRuns(query);
    return { items: rows.map(summaryOf) };
  }

  async run(id: string): Promise<EvalRunDetail> {
    const row = await this.repo.findRun(id);
    if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const items = await this.repo.runItems(id, row.run.setId);
    return { ...summaryOf(row), items: items.map(itemRow) };
  }

  async item(runId: string, itemId: string): Promise<EvalItemDetail> {
    const row = await this.repo.runItem(runId, itemId);
    if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const expected = evalExpectedSchema.safeParse(row.item.expected);
    const scores = evalItemScoreSchema.safeParse(row.scores);
    const output = rxResultSchema.safeParse(row.output);
    return {
      itemId: row.item.id,
      kind: row.item.kind,
      expected: expected.success ? expected.data : { items: [] },
      output: output.success ? output.data : null,
      scores: scores.success ? scores.data : null,
      costUsdMicros: row.costUsdMicros ?? 0,
      latencyMs: row.latencyMs,
      error: row.error,
    };
  }

  async cancel(id: string, audit: AuditScope): Promise<EvalRunSummary> {
    const found = await this.repo.findRun(id);
    if (found === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if ((await this.repo.cancelRun(id)) === undefined) throw conflict("not_cancellable");
    audit.targetId = id;
    audit.after = { status: "cancelled", set: found.setKey };
    const row = await this.repo.findRun(id);
    if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    return summaryOf(row);
  }

  async compare(aId: string, bId: string): Promise<EvalCompareResponse> {
    const [a, b] = await Promise.all([this.repo.findRun(aId), this.repo.findRun(bId)]);
    if (a === undefined || b === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const sameSet = a.run.setId === b.run.setId;
    const differences: EvalCompareResponse["differences"] = [];
    if (sameSet) {
      const [itemsA, itemsB] = await Promise.all([
        this.repo.runItems(a.run.id, a.run.setId),
        this.repo.runItems(b.run.id, b.run.setId),
      ]);
      const other = new Map(itemsB.map((row) => [row.item.id, row]));
      for (const left of itemsA) {
        const right = other.get(left.item.id);
        const l = itemRow(left);
        const r = right === undefined ? null : itemRow(right);
        const lc = l.scores?.nameCorrect ?? null;
        const rc = r?.scores?.nameCorrect ?? null;
        if (lc !== rc) {
          differences.push({
            itemId: left.item.id,
            kind: left.item.kind,
            expected: l.expected,
            aNameCorrect: lc,
            bNameCorrect: rc,
          });
        }
      }
    }
    return { a: summaryOf(a), b: summaryOf(b), sameSet, differences };
  }

  // --- Review queue ---

  async reviewQueue(): Promise<{ items: ReviewQueueItem[] }> {
    const rows = await this.repo.reviewQueue(REVIEW_QUEUE_LIMIT);
    return {
      items: rows.map((row) => {
        const result = rxResultSchema.safeParse(row.result);
        const name = result.success
          ? (result.data.items[row.correction.itemIndex]?.name ?? null)
          : null;
        // Item text only. Free text typed by a user is scrubbed of emails, phones and tokens.
        const text = (value: string | null): string | null =>
          value === null ? null : redactText(value);
        return {
          correctionId: row.correction.id,
          field: row.correction.field,
          itemName: text(name),
          before: text(row.correction.before),
          after: text(row.correction.after),
          imageAvailable: row.pages > 0,
          createdAt: row.correction.createdAt.toISOString(),
        };
      }),
    };
  }

  /**
   * Adds the corrected reading to a set as a labelled item. The expected lines are the stored
   * reading (user fixes included) reduced to item text: no patient or prescriber data ever was in
   * it. The picture is copied into the private eval prefix when it still exists; otherwise the item
   * is kept without a picture and no run reads it.
   */
  async approve(
    input: ApproveCorrectionInput,
    actorId: string,
    audit: AuditScope,
  ): Promise<{ itemId: string; imageCopied: boolean }> {
    const context = await this.repo.correctionContext(input.correctionId);
    if (context === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const set = await this.repo.findSet(input.setId);
    if (set === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if (await this.repo.alreadyAdded(context.siblingIds)) throw conflict("already_added");

    const result = rxResultSchema.safeParse(context.result);
    if (!result.success) throw conflict("no_result");
    const lines = result.data.items.flatMap((item) =>
      item.name === null || item.name.trim() === ""
        ? []
        : [
            {
              name: item.name,
              strength: item.strength,
              form: item.form,
              frequency: item.frequency,
              duration: item.duration,
              route: item.route,
            },
          ],
    );
    if (lines.length === 0) throw conflict("empty_reading");
    const expected: EvalExpected = evalExpectedSchema.parse({
      items: lines,
      origin: { correctionIds: context.siblingIds.slice(0, 50) },
    });

    const copied: { id: string; key: string; from: (typeof context.pages)[number] }[] = [];
    let imageCopied = false;
    const copyable =
      this.storage.configured &&
      context.pages.length > 0 &&
      context.pages.every((page) => page.status === "processed");
    if (copyable) {
      for (const page of context.pages) {
        const id = randomUUID();
        const key = evalImageKey(id);
        if (!(await this.storage.copy(page.r2Key, key))) break;
        copied.push({ id, key, from: page });
      }
      imageCopied = copied.length === context.pages.length;
      if (!imageCopied) {
        await Promise.all(copied.map((file) => this.storage.remove(file.key)));
        copied.length = 0;
      }
    }

    try {
      const itemId = await this.repo.addItem({
        setId: set.id,
        kind: input.kind,
        expected,
        images: copied.map((file) => ({
          id: file.id,
          ownerUserId: actorId,
          r2Key: file.key,
          bytes: file.from.bytes,
          width: file.from.width,
          height: file.from.height,
          sha256: file.from.sha256,
          dhash: file.from.dhash,
        })),
      });
      audit.targetId = itemId;
      audit.after = { set: set.key, kind: input.kind, imageCopied };
      return { itemId, imageCopied };
    } catch (error) {
      await Promise.all(copied.map((file) => this.storage.remove(file.key)));
      throw error;
    }
  }

  async reject(correctionId: string, audit: AuditScope): Promise<void> {
    if (!(await this.repo.withdrawConsent(correctionId))) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = correctionId;
    audit.after = { consent: false };
  }
}
