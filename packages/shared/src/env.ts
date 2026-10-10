import type { ZodType } from "zod";

export interface EnvIssue {
  key: string;
  /** zod issue code (e.g. `invalid_type`, `too_small`); never the offending value. */
  problem: string;
}

export type EnvResult<T> = { ok: true; data: T } | { ok: false; issues: EnvIssue[] };

export function validateEnv<T>(
  schema: ZodType<T>,
  source: Record<string, string | undefined>,
): EnvResult<T> {
  const parsed = schema.safeParse(source);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      key: issue.path.join(".") || "(root)",
      problem: issue.code,
    })),
  };
}

export interface ParseEnvDeps {
  write?: (message: string) => void;
  exit?: (code: number) => never;
}

/**
 * Boot-time env parsing: on failure prints WHICH keys are missing/invalid (never their
 * values, which may be secrets) and exits non-zero.
 */
export function parseEnv<T>(
  schema: ZodType<T>,
  source: Record<string, string | undefined> = process.env,
  deps: ParseEnvDeps = {},
): T {
  const result = validateEnv(schema, source);
  if (result.ok) {
    return result.data;
  }
  const write = deps.write ?? ((message: string) => process.stderr.write(`${message}\n`));
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const lines = result.issues.map((issue) => `  - ${issue.key} (${issue.problem})`);
  write(`Invalid environment configuration:\n${lines.join("\n")}`);
  return exit(1);
}
