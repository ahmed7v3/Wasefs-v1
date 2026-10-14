import type { AiTask } from "@wasfa/shared/ai";

/** One `/skills/<name>/SKILL.md`, as generated into `registry.generated.ts`. */
export interface SkillEntry {
  name: string;
  description: string;
  tasks: readonly AiTask[];
  /** The instructions (the file without its frontmatter). This is the system prompt of the skill. */
  body: string;
  /** First 12 hex characters of the SHA-256 of the file (LF line endings). */
  hash: string;
}
