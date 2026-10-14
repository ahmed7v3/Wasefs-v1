import ExcelJS from "exceljs";

/*
 * Reads an uploaded drug list (XLSX or JSON) into plain header -> text rows. Nothing here knows
 * about drugs: the mapping and the rules are applied later (`drug-import.plan.ts`).
 */

export type ImportFileErrorCode = "file_unreadable" | "no_rows" | "too_many_rows";

/** A problem with the file itself: permanent, shown to the admin as a code, never retried. */
export class ImportFileError extends Error {
  constructor(readonly code: ImportFileErrorCode) {
    super(`Import file refused: ${code}`);
    this.name = "ImportFileError";
  }
}

/** One data row. `row` is the line number the admin sees in Excel (the header is row 1). */
export interface RawRow {
  row: number;
  cells: Readonly<Record<string, string>>;
}

export interface ParsedFile {
  headers: string[];
  rows: RawRow[];
}

/** Far above any national drug list; protects the worker's memory from a pathological sheet. */
export const MAX_IMPORT_ROWS = 300_000;

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value)
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
    if ("error" in value) return "";
  }
  return "";
}

/** Distinct, non-empty header names: a repeated header gets " (2)", " (3)", ... */
function uniqueHeaders(raw: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header) => {
    if (header === "") return "";
    const count = (seen.get(header) ?? 0) + 1;
    seen.set(header, count);
    return count === 1 ? header : `${header} (${String(count)})`;
  });
}

async function readXlsx(bytes: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    // The streaming reader needs the shared strings before the sheets, which Excel does not write.
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError("file_unreadable");
  }
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new ImportFileError("no_rows");
  const columnCount = sheet.columnCount;

  let headerRow = 0;
  let headers: string[] = [];
  const rows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const texts = Array.from({ length: columnCount }, (_, i) => cellText(row.getCell(i + 1).value));
    if (headerRow === 0) {
      headerRow = rowNumber;
      headers = uniqueHeaders(texts);
      return;
    }
    if (texts.every((text) => text === "")) return;
    if (rows.length >= MAX_IMPORT_ROWS) throw new ImportFileError("too_many_rows");
    const cells: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header !== "") cells[header] = texts[i] ?? "";
    });
    rows.push({ row: rowNumber, cells });
  });
  return finish(
    headers.filter((header) => header !== ""),
    rows,
  );
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value))
    return value
      .map(jsonCell)
      .filter((text) => text !== "")
      .join("; ");
  return "";
}

/** An array of objects, or an object holding one (`{ "drugs": [...] }`). */
function readJson(bytes: Buffer): ParsedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ImportFileError("file_unreadable");
  }
  let list: unknown = parsed;
  if (!Array.isArray(list) && typeof list === "object" && list !== null) {
    list = Object.values(list).find((value) => Array.isArray(value));
  }
  if (!Array.isArray(list)) throw new ImportFileError("file_unreadable");
  if (list.length > MAX_IMPORT_ROWS) throw new ImportFileError("too_many_rows");

  const headers: string[] = [];
  const known = new Set<string>();
  const rows: RawRow[] = [];
  list.forEach((item: unknown, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return;
    const cells: Record<string, string> = {};
    for (const [key, value] of Object.entries(item)) {
      const name = key.trim();
      if (name === "") continue;
      if (!known.has(name)) {
        known.add(name);
        headers.push(name);
      }
      cells[name] = jsonCell(value);
    }
    rows.push({ row: index + 1, cells });
  });
  return finish(headers, rows);
}

function finish(headers: string[], rows: RawRow[]): ParsedFile {
  if (headers.length === 0 || rows.length === 0) throw new ImportFileError("no_rows");
  return { headers, rows };
}

/** XLSX when the bytes start like a zip, otherwise JSON. */
export async function readImportFile(bytes: Buffer): Promise<ParsedFile> {
  return bytes.subarray(0, 4).equals(XLSX_MAGIC) ? await readXlsx(bytes) : readJson(bytes);
}
