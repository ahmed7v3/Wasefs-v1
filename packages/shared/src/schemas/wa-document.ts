import { z } from "zod";

/*
 * Files the WhatsApp agent creates (docs/WA-AGENT.md section 8a): the `create_document` tool's
 * arguments and the `wa-agent.render-document` job payload. The model supplies data only; the
 * layouts are fixed Typst templates in the worker, so nothing here is ever markup. Every string
 * and list has a hard limit, and the worker caps pages and bytes on top.
 */

export const WA_DOCUMENT_TEMPLATES = ["report", "table", "schedule", "card"] as const;
export type WaDocumentTemplate = (typeof WA_DOCUMENT_TEMPLATES)[number];
export const WA_DOCUMENT_LANGUAGES = ["ar", "en"] as const;
export type WaDocumentLanguage = (typeof WA_DOCUMENT_LANGUAGES)[number];

/** A guest (no linked account) may only make these, with nothing from an account in them. */
export const WA_DOCUMENT_GUEST_TEMPLATES: readonly WaDocumentTemplate[] = ["report", "table"];

/** `card` is a PNG picture; everything else is a PDF. */
export const waDocumentFormat = (template: WaDocumentTemplate): "pdf" | "png" =>
  template === "card" ? "png" : "pdf";

export const WA_DOCUMENT_FILE_NAME_MAX = 60;

/** A file name safe to show and send: no path or control characters, no extension, at most 60 characters. */
export function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩<>:"/|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(pdf|png)$/i, "")
    .replace(/^\.+/, "")
    .trim();
  return Array.from(cleaned).slice(0, WA_DOCUMENT_FILE_NAME_MAX).join("").trim();
}

const fileNameSchema = z
  .string()
  .max(200)
  .transform(sanitizeFileName)
  .pipe(z.string().min(1).max(WA_DOCUMENT_FILE_NAME_MAX));

/** Control characters other than a line break make no sense in a document and are dropped. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replace(CONTROL, "").trim())
    .pipe(z.string().min(1));
/** A table cell may be empty. */
const cell = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.replace(CONTROL, "").trim());

export const WA_DOCUMENT_LIMITS = {
  title: 120,
  sections: 12,
  paragraphs: 8,
  paragraph: 1_500,
  bullets: 20,
  bullet: 300,
  note: 500,
  columns: 6,
  rows: 200,
  cell: 200,
  scheduleRows: 30,
  times: 8,
  cardLines: 8,
} as const;
const L = WA_DOCUMENT_LIMITS;

export const waReportContentSchema = z.strictObject({
  title: text(L.title),
  subtitle: text(200).optional(),
  sections: z
    .array(
      z.strictObject({
        heading: text(L.title),
        paragraphs: z.array(text(L.paragraph)).max(L.paragraphs),
        bullets: z.array(text(L.bullet)).max(L.bullets).optional(),
      }),
    )
    .min(1)
    .max(L.sections),
  footerNote: text(300).optional(),
});

export const waTableContentSchema = z
  .strictObject({
    title: text(L.title),
    columns: z.array(text(60)).min(1).max(L.columns),
    rows: z
      .array(z.array(cell(L.cell)).min(1).max(L.columns))
      .min(1)
      .max(L.rows),
    notes: text(L.note).optional(),
  })
  .refine((table) => table.rows.every((row) => row.length === table.columns.length), {
    message: "every row needs one cell per column",
    path: ["rows"],
  });

export const waScheduleContentSchema = z.strictObject({
  title: text(L.title),
  rows: z
    .array(
      z.strictObject({
        medicine: text(120),
        dose: text(120),
        times: z.array(text(30)).min(1).max(L.times),
        notes: text(200).optional(),
      }),
    )
    .min(1)
    .max(L.scheduleRows),
});

export const waCardContentSchema = z.strictObject({
  title: text(80),
  lines: z.array(text(120)).min(1).max(L.cardLines),
  footer: text(100).optional(),
});

export type WaReportContent = z.output<typeof waReportContentSchema>;
export type WaTableContent = z.output<typeof waTableContentSchema>;
export type WaScheduleContent = z.output<typeof waScheduleContentSchema>;
export type WaCardContent = z.output<typeof waCardContentSchema>;

const language = z.enum(WA_DOCUMENT_LANGUAGES);

/** One variant per template: the content shape depends on it. */
const variants = <Extra extends z.ZodRawShape>(extra: Extra) =>
  [
    z.strictObject({
      template: z.literal("report"),
      fileName: fileNameSchema,
      content: waReportContentSchema,
      ...extra,
    }),
    z.strictObject({
      template: z.literal("table"),
      fileName: fileNameSchema,
      content: waTableContentSchema,
      ...extra,
    }),
    z.strictObject({
      template: z.literal("schedule"),
      fileName: fileNameSchema,
      content: waScheduleContentSchema,
      ...extra,
    }),
    z.strictObject({
      template: z.literal("card"),
      fileName: fileNameSchema,
      content: waCardContentSchema,
      ...extra,
    }),
  ] as const;

/** The arguments of `create_document` as the model sends them (language falls back to the agent's). */
export const waCreateDocumentArgsSchema = z.discriminatedUnion(
  "template",
  variants({ language: language.optional() }),
);
export type WaCreateDocumentArgs = z.output<typeof waCreateDocumentArgsSchema>;

/** The `wa-agent.render-document` job: the tool's arguments with the language settled and the chat added. */
export const waRenderDocumentPayloadSchema = z.discriminatedUnion(
  "template",
  variants({ conversationId: z.uuid(), language }),
);
export type WaRenderDocumentPayload = z.output<typeof waRenderDocumentPayloadSchema>;

/** Where a generated file lives in the uploads bucket: `wa/out/<yyyy>/<mm>/<uuid>.<pdf|png>` (UTC). */
export const WA_DOCUMENT_KEY_PREFIX = "wa/out/";
export const waDocumentKeySchema = z
  .string()
  .max(200)
  .regex(/^wa\/out\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|png)$/, "not a generated document key");

export function waDocumentKey(now: Date, id: string, format: "pdf" | "png"): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${WA_DOCUMENT_KEY_PREFIX}${year}/${month}/${id}.${format}`;
}
