import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FONT_DIR } from "../og/fonts.js";

import { documentRequest, rxResultRequest } from "./data.js";
import { SAMPLE_NOW, SAMPLE_RX_LINK, SAMPLE_RX_RESULT, samplePayload } from "./fixtures.js";
import { TypstRenderer, type RenderRequest } from "./renderer.js";

/*
 * Image-build check (`RUN node dist/documents/smoke.js`): renders every template with the installed
 * Typst and fails the build if any does not compile. Imports only the renderer and data modules, so it
 * needs no Redis, database or network.
 */

const PDF_MAGIC = Buffer.from("%PDF");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const jobs: { name: string; request: RenderRequest }[] = [];
for (const language of ["ar", "en"] as const) {
  for (const template of ["report", "table", "schedule", "card"] as const) {
    jobs.push({
      name: `${template}/${language}`,
      request: documentRequest(samplePayload(language, template), SAMPLE_NOW),
    });
  }
  jobs.push({
    name: `rx_result/${language}`,
    request: rxResultRequest(SAMPLE_RX_RESULT, SAMPLE_RX_LINK, language, SAMPLE_NOW),
  });
}

const tempRoot = await mkdtemp(join(tmpdir(), "wasfa-smoke-"));
let failed = 0;
try {
  const renderer = new TypstRenderer({
    bin: process.env["TYPST_BIN"] ?? "typst",
    fontDir: FONT_DIR,
    tempRoot,
  });
  for (const { name, request } of jobs) {
    try {
      const { bytes, pages } = await renderer.render(request);
      const magic = request.format === "png" ? PNG_MAGIC : PDF_MAGIC;
      if (bytes.length === 0 || !bytes.subarray(0, magic.length).equals(magic)) {
        throw new Error("output is empty or has the wrong signature");
      }
      process.stdout.write(
        `smoke ok   ${name} ${request.format} ${String(bytes.length)} bytes ${String(pages)} page(s)\n`,
      );
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : "unknown";
      process.stderr.write(`smoke FAIL ${name}: ${reason}\n`);
    }
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
