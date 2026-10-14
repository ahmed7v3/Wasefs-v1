import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildLabelTemplate } from "./template.js";

/** `pnpm --filter @wasfa/worker eval:template`: rewrites `evals/rx/template.xlsx`. */
const target = resolve(import.meta.dirname, "../../../../evals/rx/template.xlsx");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, await buildLabelTemplate());
// A script: stdout is its interface.
process.stdout.write(`Wrote ${target}\n`);
