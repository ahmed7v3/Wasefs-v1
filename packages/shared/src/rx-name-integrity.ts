import { normalizeDrugName } from "./normalize.js";

/*
 * Name integrity for prescription lines: a database product may be shown AS the name the doctor wrote
 * only when what was written and the product's name agree strongly. A similar-looking brand
 * ("Riopan" for "Ripanox") or another brand with the same ingredient is a suggestion, never a
 * replacement. Pure and dependency-free.
 */

/** Trigram similarity (pg_trgm's measure) the written name needs against the product's brand name. */
export const NAME_AGREE_SIMILARITY = 0.8;
/** Shortest name (letters) for which one wrong, missing or swapped letter still counts as the same name. */
export const NAME_TYPO_MIN_LENGTH = 5;
/** Largest edit distance (Damerau, adjacent swaps count 1) that is still a typo of the same name. */
export const NAME_TYPO_MAX_DISTANCE = 1;
/** The shortest name that may agree with a longer one only by being its leading words ("Panadol" / "Panadol Extra"). */
const FAMILY_MIN_LENGTH = 4;

/** What the integrity check reads from a database product. */
export interface NameProduct {
  brandEn: string;
  brandAr?: string | null;
  /** The brand family key; empty or absent when not backfilled. */
  brandKey?: string | null;
}

const words = (name: string): string[] => name.split(/\s+/).filter((word) => word !== "");

/** The set of trigrams pg_trgm builds: each word padded with two spaces before and one after. */
function trigrams(name: string): Set<string> {
  const out = new Set<string>();
  for (const word of words(name)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm `similarity()`: shared trigrams over all trigrams, 0-1. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Optimal-string-alignment (Damerau) distance: insert, delete, substitute or swap neighbours, each 1. */
export function damerauDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const rows: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= y.length; j++) (rows[0] as number[])[j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let best = Math.min(
        (rows[i - 1]?.[j] ?? 0) + 1,
        (rows[i]?.[j - 1] ?? 0) + 1,
        (rows[i - 1]?.[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        best = Math.min(best, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
      (rows[i] as number[])[j] = best;
    }
  }
  return rows[x.length]?.[y.length] ?? 0;
}

/** Whether the shorter name is the leading whole words of the longer one ("panadol" / "panadol extra"). */
function sameFamily(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (Array.from(short).length < FAMILY_MIN_LENGTH) return false;
  const shortWords = words(short);
  const longWords = words(long);
  return (
    shortWords.length < longWords.length && shortWords.every((word, i) => word === longWords[i])
  );
}

function namesAgree(reading: string, name: string): boolean {
  if (reading === "" || name === "") return false;
  if (reading === name) return true;
  const joinedReading = reading.replace(/\s+/g, "");
  const joinedName = name.replace(/\s+/g, "");
  if (joinedReading === joinedName) return true;
  if (sameFamily(reading, name)) return true;
  if (
    Math.min(Array.from(joinedReading).length, Array.from(joinedName).length) >=
      NAME_TYPO_MIN_LENGTH &&
    damerauDistance(joinedReading, joinedName) <= NAME_TYPO_MAX_DISTANCE
  ) {
    return true;
  }
  return (
    Math.max(trigramSimilarity(reading, name), trigramSimilarity(joinedReading, joinedName)) >=
    NAME_AGREE_SIMILARITY
  );
}

/**
 * Whether the name as written (`reading`) and a database product agree strongly enough for the product
 * to be shown as that line's name: the same name, the same brand family, one typo in a name of 5+
 * letters, or a brand-name trigram similarity of at least `NAME_AGREE_SIMILARITY`. Compared against
 * the product's brand key and English and Arabic brand names, never against its ingredient.
 * An exact learned alias is a statement of fact and is decided by the caller, not here.
 */
export function nameAgrees(reading: string, product: NameProduct): boolean {
  const written = normalizeDrugName(reading).name;
  const names = [product.brandKey ?? "", product.brandEn, product.brandAr ?? ""]
    .map((name) => normalizeDrugName(name).name)
    .filter((name) => name !== "");
  return names.some((name) => namesAgree(written, name));
}
