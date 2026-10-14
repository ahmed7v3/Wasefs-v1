import { SKILL_REGISTRY } from "./registry.generated.js";

import type { SkillEntry } from "./types.js";

export type { SkillEntry } from "./types.js";
export { SKILL_REGISTRY } from "./registry.generated.js";

/** The skill by name; an unknown name is a programming error, not a user error. */
export function getSkill(name: string): SkillEntry {
  const skill = SKILL_REGISTRY.find((entry) => entry.name === name);
  if (!skill) throw new Error(`Unknown skill "${name}"`);
  return skill;
}

/** `<name>@<hash>`: stored on every analysis and part of the exact-match cache key. */
export function skillVersion(name: string): string {
  return `${name}@${getSkill(name).hash}`;
}
