/*
 * CSV for the usage export. Spreadsheet programs run a cell that starts with `=`, `+`, `-` or `@`
 * (and a tab or carriage return) as a formula, so any text cell starting that way is defused with a
 * leading apostrophe. Numbers and booleans are written as they are: they cannot start a formula
 * (a negative number is a number, not text).
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly CsvCell[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
