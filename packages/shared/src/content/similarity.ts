import { normalizeArabic } from "../normalize.js";

/*
 * Near-duplicate detection (CONTENT-PLATFORM §6.2). Exact Jaccard on 5-word shingles is used when
 * both texts are at hand; a 128-value MinHash signature is stored per revision so the API can compare
 * a new draft with thousands of published items without loading their bodies. No dependencies, and
 * the hash is seeded and fixed, so a signature computed today equals one computed after a deploy.
 */

export const SHINGLE_SIZE = 5;
export const MINHASH_SIZE = 128;
const SIGNATURE_BYTES = MINHASH_SIZE * 4;
const EMPTY_VALUE = 0xffffffff;

function words(text: string): string[] {
  return (
    normalizeArabic(text)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Every run of five consecutive words; shorter non-empty texts yield one shingle so they still compare. */
export function shingles(text: string): Set<string> {
  const tokens = words(text);
  const out = new Set<string>();
  if (tokens.length === 0) return out;
  if (tokens.length < SHINGLE_SIZE) {
    out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i += 1) {
    out.add(tokens.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return out;
}

/** Exact |A ∩ B| / |A ∪ B| of two shingle sets; two empty sets are 0, not identical. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const item of small) if (large.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function fmix32(input: number): number {
  let h = input >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** One fixed seed per permutation, derived rather than stored. */
const SEEDS: readonly number[] = Array.from({ length: MINHASH_SIZE }, (_, i) =>
  fmix32(Math.imul(i + 1, 0x9e3779b1)),
);

/** The 128 minimum hash values of a text; every value is 0xFFFFFFFF for a text with no words. */
export function minhashValues(text: string): Uint32Array {
  const out = new Uint32Array(MINHASH_SIZE).fill(EMPTY_VALUE);
  for (const shingle of shingles(text)) {
    const base = fnv1a(shingle);
    for (let i = 0; i < MINHASH_SIZE; i += 1) {
      const value = fmix32(base ^ (SEEDS[i] ?? 0));
      if (value < (out[i] ?? EMPTY_VALUE)) out[i] = value;
    }
  }
  return out;
}

/** Big-endian bytes of a signature: 512 bytes, the form stored in `content_revisions.minhash`. */
export function signatureToBytes(values: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value, false));
  return bytes;
}

export function signatureFromBytes(bytes: Uint8Array): Uint32Array {
  const count = Math.floor(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 4);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = view.getUint32(i * 4, false);
  return out;
}

/** Signature of a text as stored bytes. */
export function minhashSignature(text: string): Uint8Array {
  return signatureToBytes(minhashValues(text));
}

/** Estimated Jaccard: the share of positions where the two signatures agree. 0 when either text had no words. */
export function estimateJaccard(a: Uint8Array, b: Uint8Array): number {
  if (a.byteLength !== SIGNATURE_BYTES || b.byteLength !== SIGNATURE_BYTES) return 0;
  const left = signatureFromBytes(a);
  const right = signatureFromBytes(b);
  let equal = 0;
  let empty = 0;
  for (let i = 0; i < MINHASH_SIZE; i += 1) {
    if (left[i] === EMPTY_VALUE || right[i] === EMPTY_VALUE) empty += 1;
    else if (left[i] === right[i]) equal += 1;
  }
  return empty === MINHASH_SIZE ? 0 : equal / MINHASH_SIZE;
}
