import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseEnv, validateEnv } from "../src/env.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(10),
});

describe("env parsing", () => {
  it("returns typed data when valid", () => {
    const env = parseEnv(schema, { PORT: "4000", DATABASE_URL: "postgres://localhost/db" });
    expect(env).toEqual({ PORT: 4000, DATABASE_URL: "postgres://localhost/db" });
  });

  it("reports which keys are bad but never their values", () => {
    const secret = "s3cr3t-value";
    const result = validateEnv(schema, { PORT: "not-a-number", DATABASE_URL: secret.slice(0, 3) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.key).sort()).toEqual(["DATABASE_URL", "PORT"]);
      expect(JSON.stringify(result.issues)).not.toContain("not-a-number");
      expect(JSON.stringify(result.issues)).not.toContain(secret.slice(0, 3));
    }
  });

  it("prints key names and exits non-zero on failure", () => {
    const written: string[] = [];
    let exitCode: number | undefined;
    const fakeExit = (code: number): never => {
      exitCode = code;
      throw new Error("exit");
    };
    expect(() =>
      parseEnv(
        schema,
        { PORT: "oops" },
        { write: (m) => written.push(m), exit: fakeExit },
      ),
    ).toThrow("exit");
    expect(exitCode).toBe(1);
    expect(written.join("\n")).toContain("PORT");
    expect(written.join("\n")).toContain("DATABASE_URL");
    expect(written.join("\n")).not.toContain("oops");
  });
});
