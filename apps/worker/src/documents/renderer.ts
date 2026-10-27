import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Renders the WhatsApp agent's files with Typst (docs/WA-AGENT.md section 8a). The templates are
 * fixed files in this repository; the content travels in `data.json` and is read by the template with
 * `json("data.json")`, so a customer's words are shown as text and never evaluated as markup. Each
 * render runs in a fresh temporary directory that holds only `main.typ` (the shared library followed
 * by the template) and `data.json`, with `--root` set to it, so a template cannot read anything else.
 * The command line carries fixed names and paths only, never user input.
 */

export const DOCUMENT_TEMPLATE_IDS = ["report", "table", "schedule", "card", "rx_result"] as const;
export type DocumentTemplateId = (typeof DOCUMENT_TEMPLATE_IDS)[number];

export const RENDER_TIMEOUT_MS = 20_000;
export const RENDER_MAX_BYTES = 5 * 1024 * 1024;
export const RENDER_MAX_PAGES = 30;
/** The card is a 540 x 675 pt page: at this resolution it is the 1080 x 1350 px picture. */
const PNG_PPI = 144;

export type RenderErrorCode = "timeout" | "failed" | "too_large" | "too_many_pages" | "no_output";

/** A render that did not produce a usable file. The code is safe to log; Typst's own text is not kept. */
export class DocumentRenderError extends Error {
  constructor(readonly code: RenderErrorCode) {
    super(`Document render failed: ${code}`);
    this.name = "DocumentRenderError";
  }
}

/** A short code for logs: the render error code, else the error class. */
export const renderReason = (error: unknown): string =>
  error instanceof DocumentRenderError
    ? error.code
    : error instanceof Error
      ? error.name
      : "unknown";

export interface RenderRequest {
  template: DocumentTemplateId;
  /** Everything the template shows; serialized as `data.json`. */
  data: Record<string, unknown>;
  format: "pdf" | "png";
}

export interface RenderedDocument {
  bytes: Buffer;
  pages: number;
}

/** What the jobs depend on, so tests can use a fake and the image can use the real binary. */
export interface DocumentRenderer {
  render(request: RenderRequest): Promise<RenderedDocument>;
}

export interface ExecResult {
  code: number | null;
  timedOut: boolean;
}

/** Runs the compiler; replaceable in tests. Must kill the process when `timeoutMs` passes. */
export type TypstExec = (invocation: {
  bin: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
}) => Promise<ExecResult>;

const PASS_ENV = ["PATH", "Path", "SystemRoot"] as const;

/** Spawns without a shell, with a bare environment and the output discarded (it can quote the content). */
export const spawnTypst: TypstExec = ({ bin, args, cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const env: Record<string, string> = { HOME: cwd, TMPDIR: cwd };
    for (const name of PASS_ENV) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    const child = spawn(bin, [...args], { cwd, env, stdio: "ignore", windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });

const TEMPLATE_DIRS = [
  fileURLToPath(new URL("./templates/", import.meta.url)),
  // Compiled output (`dist/documents`) has no copy of the .typ files; the repository layout and the image keep `src/documents/templates`.
  fileURLToPath(new URL("../../src/documents/templates/", import.meta.url)),
];

/** Pages of a PDF Typst wrote: one `/Type /Page` object each (the `/Pages` tree node is not counted). */
export function countPdfPages(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}

export interface TypstRendererOptions {
  /** The `typst` binary (`TYPST_BIN`). */
  bin: string;
  /** The directory with the bundled IBM Plex Sans Arabic faces; system fonts are ignored. */
  fontDir: string;
  /** Where `lib.typ` and the templates are; found next to this file when omitted. */
  templateDir?: string | undefined;
  exec?: TypstExec | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  maxPages?: number | undefined;
  /** Parent of the per-render directories. */
  tempRoot?: string | undefined;
}

export class TypstRenderer implements DocumentRenderer {
  private readonly exec: TypstExec;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxPages: number;
  private readonly tempRoot: string;

  constructor(private readonly options: TypstRendererOptions) {
    this.exec = options.exec ?? spawnTypst;
    this.timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? RENDER_MAX_BYTES;
    this.maxPages = options.maxPages ?? RENDER_MAX_PAGES;
    this.tempRoot = options.tempRoot ?? tmpdir();
  }

  private async templateFile(name: string): Promise<string> {
    const directories =
      this.options.templateDir === undefined ? TEMPLATE_DIRS : [this.options.templateDir];
    for (const directory of directories) {
      const path = join(directory, name);
      try {
        await stat(path);
        return path;
      } catch {
        // try the next location
      }
    }
    throw new Error(`Document template not found: ${name}`);
  }

  async render({ template, data, format }: RenderRequest): Promise<RenderedDocument> {
    // The id picks a file from a fixed list; it is never a path from the outside.
    if (!(DOCUMENT_TEMPLATE_IDS as readonly string[]).includes(template)) {
      throw new DocumentRenderError("failed");
    }
    const directory = await mkdtemp(join(this.tempRoot, "wasfa-doc-"));
    try {
      const [lib, body] = await Promise.all([
        readFile(await this.templateFile("lib.typ"), "utf8"),
        readFile(await this.templateFile(`${template}.typ`), "utf8"),
      ]);
      await writeFile(join(directory, "main.typ"), `${lib}\n${body}`);
      await writeFile(join(directory, "data.json"), JSON.stringify(data));

      const output = `out.${format}`;
      const args = [
        "compile",
        "--root",
        directory,
        "--font-path",
        this.options.fontDir,
        "--ignore-system-fonts",
        "--format",
        format,
        ...(format === "png" ? ["--ppi", String(PNG_PPI)] : []),
        "main.typ",
        output,
      ];
      const result = await this.exec({
        bin: this.options.bin,
        args,
        cwd: directory,
        timeoutMs: this.timeoutMs,
      });
      if (result.timedOut) throw new DocumentRenderError("timeout");
      if (result.code !== 0) throw new DocumentRenderError("failed");

      let size: number;
      try {
        size = (await stat(join(directory, output))).size;
      } catch {
        throw new DocumentRenderError("no_output");
      }
      if (size === 0) throw new DocumentRenderError("no_output");
      if (size > this.maxBytes) throw new DocumentRenderError("too_large");
      const bytes = await readFile(join(directory, output));
      const pages = format === "png" ? 1 : countPdfPages(bytes);
      if (pages === 0) throw new DocumentRenderError("no_output");
      if (pages > this.maxPages) throw new DocumentRenderError("too_many_pages");
      return { bytes, pages };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
