import type { z } from "zod";

/*
 * Turns the zod schema of a settings key (the registry in `@wasfa/shared/settings`) into a list of
 * form fields, and converts between what the form edits (strings and booleans) and the value the API
 * stores. The registry stays the single source of truth: add a field to a schema and it appears here.
 * Types the form cannot draw (none today) fall back to a JSON text field instead of disappearing.
 */

export type SettingField =
  | { kind: "group"; name: string; path: string; fields: SettingField[] }
  | { kind: "enum"; name: string; path: string; nullable: boolean; options: string[] }
  | {
      kind: "text" | "number" | "boolean" | "list" | "json";
      name: string;
      path: string;
      nullable: boolean;
    };

/** What the form holds per leaf: text for everything but checkboxes. Keyed by dotted path. */
export type SettingDraft = Record<string, string | boolean>;

type Def = Record<string, unknown>;

function isSchema(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value;
}

function defOf(schema: z.ZodType): Def {
  return schema._zod.def as unknown as Def;
}

const WRAPPERS = new Set(["nullable", "optional", "default", "prefault", "readonly"]);

/** Strips `default`/`nullable`/`optional` and the input side of a `pipe` (the email transform chain). */
function unwrap(schema: z.ZodType): { schema: z.ZodType; nullable: boolean } {
  let current = schema;
  let nullable = false;
  for (let depth = 0; depth < 12; depth += 1) {
    const def = defOf(current);
    const type = String(def["type"]);
    if (type === "nullable") nullable = true;
    const inner = def["innerType"];
    if (WRAPPERS.has(type) && isSchema(inner)) {
      current = inner;
      continue;
    }
    const input = def["in"];
    if (type === "pipe" && isSchema(input)) {
      current = input;
      continue;
    }
    break;
  }
  return { schema: current, nullable };
}

function describe(name: string, path: string, schema: z.ZodType): SettingField {
  const { schema: inner, nullable } = unwrap(schema);
  const def = defOf(inner);
  switch (String(def["type"])) {
    case "string":
      return { kind: "text", name, path, nullable };
    case "number":
      return { kind: "number", name, path, nullable };
    case "boolean":
      return { kind: "boolean", name, path, nullable };
    case "enum": {
      const entries = def["entries"];
      const options =
        typeof entries === "object" && entries !== null
          ? Object.values(entries).map((entry) => String(entry))
          : [];
      return { kind: "enum", name, path, nullable, options };
    }
    case "array": {
      const element = def["element"];
      if (isSchema(element) && String(defOf(unwrap(element).schema)["type"]) === "string") {
        return { kind: "list", name, path, nullable };
      }
      return { kind: "json", name, path, nullable };
    }
    case "object":
      return { kind: "group", name, path, fields: objectFields(inner, path) };
    default:
      return { kind: "json", name, path, nullable };
  }
}

function objectFields(schema: z.ZodType, prefix: string): SettingField[] {
  const shape = defOf(schema)["shape"];
  if (typeof shape !== "object" || shape === null) return [];
  return Object.entries(shape).flatMap(([name, child]) =>
    isSchema(child) ? [describe(name, prefix ? `${prefix}.${name}` : name, child)] : [],
  );
}

/** The fields of a settings key: the shape of its `z.object` (refinements such as `currency`'s are kept). */
export function settingFields(schema: z.ZodType): SettingField[] {
  return objectFields(unwrap(schema).schema, "");
}

function valueAt(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function draftOf(field: SettingField, value: unknown, draft: SettingDraft): void {
  if (field.kind === "group") {
    for (const child of field.fields) draftOf(child, value, draft);
    return;
  }
  const current = valueAt(value, field.path);
  switch (field.kind) {
    case "boolean":
      draft[field.path] = current === true;
      break;
    case "list":
      draft[field.path] = Array.isArray(current) ? current.map(String).join("\n") : "";
      break;
    case "json":
      draft[field.path] = current === undefined ? "" : JSON.stringify(current, null, 2);
      break;
    default:
      draft[field.path] = current === null || current === undefined ? "" : String(current);
  }
}

/** The form's starting state for a stored (or default) value. */
export function toDraft(fields: readonly SettingField[], value: unknown): SettingDraft {
  const draft: SettingDraft = {};
  for (const field of fields) draftOf(field, value, draft);
  return draft;
}

function leafValue(
  field: Exclude<SettingField, { kind: "group" }>,
  raw: string | boolean | undefined,
): unknown {
  if (field.kind === "boolean") return raw === true;
  const text = typeof raw === "string" ? raw : "";
  switch (field.kind) {
    case "number": {
      if (text.trim() === "") return field.nullable ? null : undefined;
      const parsed = Number(text);
      // A non-number is passed on as text so the schema rejects it with its own message.
      return Number.isFinite(parsed) ? parsed : text;
    }
    case "list":
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    case "json":
      if (text.trim() === "") return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    case "enum":
      return text === "" && field.nullable ? null : text;
    default: {
      const trimmed = text.trim();
      return trimmed === "" && field.nullable ? null : trimmed;
    }
  }
}

function assign(fields: readonly SettingField[], draft: SettingDraft): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.name] =
      field.kind === "group" ? assign(field.fields, draft) : leafValue(field, draft[field.path]);
  }
  return result;
}

/** The value to validate with the registry schema and send to the API. */
export function fromDraft(
  fields: readonly SettingField[],
  draft: SettingDraft,
): Record<string, unknown> {
  return assign(fields, draft);
}
