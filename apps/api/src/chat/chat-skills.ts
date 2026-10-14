/**
 * The body of a chat skill (`skills/<key>/SKILL.md`), appended to the system prompt right after the
 * fixed persona so the prefix stays cache-friendly. TODO(2.11): switch to the generated skills
 * registry of `@wasfa/ai` once it exists.
 */
export function skillBody(skill: string | null): string | null {
  void skill;
  return null;
}
