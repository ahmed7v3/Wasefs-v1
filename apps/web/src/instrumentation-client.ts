import { z } from "zod";

/*
 * Runs in the browser before any other application code (Next.js "instrumentation-client").
 *
 * Zod 4 compiles fast parsers with `new Function(...)` and first probes whether that is allowed.
 * Our Content-Security-Policy forbids `eval`, so the probe throws (zod catches it and falls back),
 * but the browser still logs a CSP violation for it on every page that builds a schema. Turning the
 * compiler off skips the probe: parsing is marginally slower and the console stays clean. It must run
 * before the first schema is created, which is why it lives here and not in a component.
 */
z.config({ jitless: true });
