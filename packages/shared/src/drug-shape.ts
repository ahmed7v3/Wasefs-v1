/*
 * Letter-shape matching for a medicine name the model could not read clearly (T1: the database helps
 * with names the model cannot read). Pure and dependency-free: the database lookup in
 * `packages/db/src/drug-matcher.ts` fetches a small pool of brand keys with the same first two letters
 * and a similar length, and this module ranks that pool by consonant skeleton. A shape candidate is a
 * suggestion for the verification step, never an accepted match on its own.
 */

/** Vowels (and "y", which reads as a vowel in brand names) and spaces: removed to get the skeleton. */
const SKELETON_DROP = /[aeiouy\s]/g;

/** Fewest letters a reading needs before the shape lookup is meaningful. */
export const SHAPE_MIN_LENGTH = 3;
/** Brand keys may differ from the reading by this many letters in length. */
export const SHAPE_LENGTH_WINDOW = 2;
/** Skeleton similarity a candidate needs to be offered at all (1 = identical skeleton). */
export const SHAPE_MIN_SIMILARITY = 0.6;

/** The consonants of a brand key, in order: "bepra" → "bpr", "motidyl" → "mtdl". */
export function consonantSkeleton(key: string): string {
  return key.toLowerCase().replace(SKELETON_DROP, "");
}

/** Edit distance between two strings (insertions, deletions and substitutions cost 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** 0-1 similarity of two brand keys by their consonant skeletons: 1 - distance / longer skeleton. */
export function shapeSimilarity(reading: string, brandKey: string): number {
  const a = consonantSkeleton(reading);
  const b = consonantSkeleton(brandKey);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return Math.max(0, 1 - levenshtein(a, b) / longest);
}

/**
 * Whether a brand key is worth scoring for a reading: the same first two letters and a length within
 * the window. The SQL pool uses the same rule, so it is stated once here for the tests.
 */
export function isShapePoolKey(reading: string, brandKey: string): boolean {
  if (reading.length < SHAPE_MIN_LENGTH || brandKey === "") return false;
  return (
    brandKey.slice(0, 2) === reading.slice(0, 2) &&
    Math.abs(brandKey.length - reading.length) <= SHAPE_LENGTH_WINDOW
  );
}
