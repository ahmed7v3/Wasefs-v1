import { randomUUID } from "node:crypto";

import { evalImageKey, evalStagingKey, groupEvalSheet } from "@wasfa/shared/evals";
import {
  EVAL_IMPORT_SHEET_MAX_BYTES,
  type EvalImportReport,
} from "@wasfa/shared/schemas/admin-evals";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";
import { fileTypeFromBuffer } from "file-type";

import { processImage, type ProcessedImage } from "../images/process-image.js";
import { ImageRejected } from "../images/rejected.js";
import { ImportFileError, readImportFile } from "../jobs/drug-import.file.js";
import {
  findOrCreateSet,
  insertEvalImage,
  insertEvalItem,
  setHasImage,
} from "../jobs/eval.repo.js";

import type { ObjectStore } from "../storage/object-store.js";
import type { Database } from "@wasfa/db";
import type { JobPayload } from "@wasfa/shared/queues";

/** The import cannot start at all (as opposed to a row that is skipped with an issue). */
export class EvalImportError extends Error {
  constructor(readonly code: "sheet_missing" | "sheet_unreadable" | "sheet_empty") {
    super(`Eval import failed: ${code}`);
    this.name = "EvalImportError";
  }
}

export interface EvalImportDeps {
  db: Database;
  storage: ObjectStore;
}

export type EvalImportOutcome = Pick<EvalImportReport, "setId" | "created" | "issues">;

type Payload = JobPayload<"evals", "evals.import">;
type Issue = EvalImportReport["issues"][number];

const MAX_ISSUES = 200;
const baseName = (name: string): string => name.replaceAll("\\", "/").split("/").pop() ?? name;

/**
 * Imports a labelled set (Task 2.10). The api left the label sheet and the images in object storage
 * under `evals/rx/staging/<batch>/`; this reads the sheet, matches its rows to the uploaded images,
 * re-encodes every image like any upload (orientation applied, EXIF and GPS dropped, 2048 px
 * JPEG), stores it under the private `evals/rx/` prefix with a `files` row owned by the importing
 * admin and no expiry, and adds one `ai_eval_items` row per prescription. A row that cannot be
 * used is reported by row or file name and skipped; the rest of the sheet still imports. Running
 * it twice adds nothing twice (a prescription whose first page is already in the set is skipped).
 * Reports carry row numbers, file names and codes, never labelled text.
 */
export async function importEvalSet(
  { db, storage }: EvalImportDeps,
  payload: Payload,
): Promise<EvalImportOutcome> {
  const { batchId, actorId } = payload;
  const issues: Issue[] = [];
  const report = (issue: Issue): void => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  const sheetBytes = await storage.get(
    evalStagingKey(batchId, "sheet.xlsx"),
    EVAL_IMPORT_SHEET_MAX_BYTES,
  );
  if (sheetBytes === null) throw new EvalImportError("sheet_missing");
  let parsed;
  try {
    parsed = await readImportFile(sheetBytes);
  } catch (error) {
    if (error instanceof ImportFileError) {
      throw new EvalImportError(error.code === "no_rows" ? "sheet_empty" : "sheet_unreadable");
    }
    throw error;
  }

  const grouped = groupEvalSheet(parsed.headers, parsed.rows);
  for (const issue of grouped.issues) report({ row: issue.row, name: null, code: issue.code });

  const uploaded = new Map(
    payload.images.map((name, index) => [baseName(name).toLowerCase(), index]),
  );
  const used = new Set<number>();
  const setId = await findOrCreateSet(db, {
    key: payload.setKey,
    name: payload.setName,
    description: payload.description,
  });
  let created = 0;

  for (const item of grouped.items) {
    const indexes = item.imageNames.map((name) => uploaded.get(baseName(name).toLowerCase()));
    const missing = item.imageNames.filter((_, i) => indexes[i] === undefined);
    if (missing.length > 0) {
      for (const name of missing) report({ row: null, name, code: "image_not_uploaded" });
      continue;
    }

    // Process every page first; nothing is stored until the whole prescription is acceptable.
    const processed: ProcessedImage[] = [];
    let rejected: string | null = null;
    for (const [i, index] of indexes.entries()) {
      const name = item.imageNames[i] ?? "";
      const bytes =
        index === undefined
          ? null
          : await storage.get(evalStagingKey(batchId, `img-${String(index)}`), UPLOAD_MAX_BYTES);
      if (index !== undefined) used.add(index);
      if (bytes === null) {
        report({ row: null, name, code: "image_missing" });
        rejected = "image_missing";
        break;
      }
      try {
        const mime = (await fileTypeFromBuffer(bytes))?.mime ?? "";
        processed.push(await processImage(bytes, mime));
      } catch (error) {
        if (!(error instanceof ImageRejected)) throw error;
        report({ row: null, name, code: error.reason });
        rejected = error.reason;
        break;
      }
    }
    const first = processed[0];
    if (rejected !== null || first === undefined) continue;
    if (await setHasImage(db, setId, first.sha256)) {
      report({ row: null, name: item.imageNames[0] ?? null, code: "already_in_set" });
      continue;
    }

    const fileIds: string[] = [];
    for (const image of processed) {
      const id = randomUUID();
      const key = evalImageKey(id);
      await storage.put(key, image.jpeg, "image/jpeg");
      await insertEvalImage(db, {
        id,
        ownerUserId: actorId,
        r2Key: key,
        bytes: image.jpeg.byteLength,
        width: image.width,
        height: image.height,
        sha256: image.sha256,
        dhash: image.dhash,
      });
      fileIds.push(id);
    }
    await insertEvalItem(db, { setId, fileIds, kind: item.kind, expected: item.expected });
    created++;
  }

  payload.images.forEach((name, index) => {
    if (!used.has(index)) report({ row: null, name, code: "image_unused" });
  });
  await cleanStaging(storage, batchId, payload.images.length);
  return { setId, created, issues };
}

/** The staged copies hold unprocessed originals: they are not kept a moment longer than needed. */
async function cleanStaging(storage: ObjectStore, batchId: string, images: number): Promise<void> {
  const keys = [
    evalStagingKey(batchId, "sheet.xlsx"),
    ...Array.from({ length: images }, (_, i) => evalStagingKey(batchId, `img-${String(i)}`)),
  ];
  await Promise.all(keys.map((key) => storage.remove(key).catch(() => undefined)));
}
