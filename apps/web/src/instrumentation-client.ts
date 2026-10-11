// Only the core `config` (one small module), not the whole `zod` package: this file runs on every
// page, including the public ones that never build a schema.
import { config } from "zod/v4/core";

/*
 * Runs in the browser before any other application code (Next.js "instrumentation-client").
 *
 * Zod 4 compiles fast parsers with `new Function(...)` and first probes whether that is allowed.
 * Our Content-Security-Policy forbids `eval`, so the probe throws (zod catches it and falls back),
 * but the browser still logs a CSP violation for it on every page that builds a schema. Turning the
 * compiler off skips the probe: parsing is marginally slower and the console stays clean. It must run
 * before the first schema is created, which is why it lives here and not in a component.
 */
config({ jitless: true });
