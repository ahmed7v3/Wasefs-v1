import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SKILL_REGISTRY, getSkill, skillVersion } from "../src/skills/index.js";

const script = fileURLToPath(new URL("../scripts/build-skills.mjs", import.meta.url));

describe("skill registry", () => {
  it("is not stale: SKILL.md files and registry.generated.ts agree", () => {
    const run = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    // The message names the fix; a failure here means "run pnpm --filter @wasfa/ai build:skills".
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("has the prescription skill with its tasks and instructions", () => {
    const skill = getSkill("prescription-analysis");
    expect(skill.tasks).toEqual(["rx_extract", "rx_verify"]);
    expect(skill.body).toContain("<user_data>");
    expect(skill.body.startsWith("# Prescription analysis")).toBe(true);
  });

  it("versions a skill as name@hash with a 12 hex character hash", () => {
    expect(skillVersion("prescription-analysis")).toMatch(/^prescription-analysis@[0-9a-f]{12}$/);
    for (const skill of SKILL_REGISTRY) expect(skill.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("refuses an unknown skill", () => {
    expect(() => getSkill("nope")).toThrow("Unknown skill");
  });
});
