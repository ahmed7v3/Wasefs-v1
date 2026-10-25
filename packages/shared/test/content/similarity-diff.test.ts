import { describe, expect, it } from "vitest";

import { diffStats, diffWords, type DiffOp } from "../../src/content/diff.js";
import {
  MINHASH_SIZE,
  estimateJaccard,
  jaccard,
  minhashSignature,
  minhashValues,
  shingles,
  signatureFromBytes,
  signatureToBytes,
} from "../../src/content/similarity.js";

/** Deterministic pseudo-random prose: a seed picks words from a vocabulary, so two seeds share almost no 5-grams. */
function prose(seed: number, words: number, vocabulary: readonly string[]): string[] {
  let state = seed >>> 0;
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push(vocabulary[(state >>> 8) % vocabulary.length] ?? "");
  }
  return out;
}

const ARABIC = Array.from(
  { length: 400 },
  (_, i) => `كلمة${String.fromCharCode(0x0627 + (i % 28))}${String(i)}`,
);
const ENGLISH = Array.from({ length: 400 }, (_, i) => `word${String(i)}x`);

/** `words` with `edits` evenly spread words replaced. */
function edited(words: readonly string[], edits: number): string[] {
  const copy = [...words];
  const step = Math.floor(copy.length / (edits + 1));
  for (let i = 1; i <= edits; i += 1) copy[i * step] = `تعديل${String(i)}`;
  return copy;
}

describe("shingles and jaccard", () => {
  it("makes 5-word shingles over normalised, lower-cased text", () => {
    const set = shingles("Take one tablet daily after breakfast please");
    expect(set.size).toBe(3);
    expect(set.has("take one tablet daily after")).toBe(true);
  });

  it("ignores tashkeel, alef variants and case", () => {
    expect([...shingles("أخذ الدواء مرتين يومي\u064Bا بعد الأكل")]).toEqual([
      ...shingles("اخذ الدواء مرتين يوميا بعد الاكل"),
    ]);
    expect([...shingles("Take ONE tablet daily after food")]).toEqual([
      ...shingles("take one tablet daily after food"),
    ]);
  });

  it("is safe on empty and short text", () => {
    expect(shingles("").size).toBe(0);
    expect(shingles("two words").size).toBe(1);
    expect(jaccard(shingles(""), shingles(""))).toBe(0);
    expect(jaccard(shingles("two words"), shingles(""))).toBe(0);
    expect(jaccard(shingles("two words"), shingles("two words"))).toBe(1);
  });

  it("computes the exact Jaccard index", () => {
    const a = new Set(["a", "b", "c", "d"]);
    const b = new Set(["c", "d", "e", "f"]);
    expect(jaccard(a, b)).toBeCloseTo(2 / 6, 10);
    expect(jaccard(a, a)).toBe(1);
  });

  it("scores a near-copy at or above 0.6 and unrelated text below 0.2", () => {
    const original = prose(1, 160, ARABIC);
    const nearCopy = edited(original, 3);
    const unrelated = prose(99, 160, ARABIC);
    expect(
      jaccard(shingles(original.join(" ")), shingles(nearCopy.join(" "))),
    ).toBeGreaterThanOrEqual(0.6);
    expect(jaccard(shingles(original.join(" ")), shingles(unrelated.join(" ")))).toBeLessThan(0.2);
  });
});

describe("minhash", () => {
  it("has 128 uint32 values and is deterministic", () => {
    const text = prose(7, 80, ENGLISH).join(" ");
    const a = minhashSignature(text);
    expect(a.byteLength).toBe(MINHASH_SIZE * 4);
    expect(Array.from(minhashSignature(text))).toEqual(Array.from(a));
    expect(minhashValues(text)).toHaveLength(MINHASH_SIZE);
  });

  it("round-trips through bytes", () => {
    const values = minhashValues(prose(3, 60, ARABIC).join(" "));
    expect(Array.from(signatureFromBytes(signatureToBytes(values)))).toEqual(Array.from(values));
  });

  it("estimates within 0.15 of the exact Jaccard across overlaps, in both scripts", () => {
    for (const vocabulary of [ARABIC, ENGLISH]) {
      const base = prose(11, 400, vocabulary);
      for (const edits of [0, 1, 4, 10, 25, 60]) {
        const other = edited(base, edits);
        const exact = jaccard(shingles(base.join(" ")), shingles(other.join(" ")));
        const estimate = estimateJaccard(
          minhashSignature(base.join(" ")),
          minhashSignature(other.join(" ")),
        );
        expect(Math.abs(estimate - exact), `${String(edits)} edits`).toBeLessThanOrEqual(0.15);
      }
    }
  });

  it("estimates unrelated texts near zero and identical texts at one", () => {
    const a = prose(21, 300, ENGLISH).join(" ");
    const b = prose(22, 300, ENGLISH).join(" ");
    expect(estimateJaccard(minhashSignature(a), minhashSignature(b))).toBeLessThan(0.1);
    expect(estimateJaccard(minhashSignature(a), minhashSignature(a))).toBe(1);
  });

  it("treats empty text as similar to nothing", () => {
    const empty = minhashSignature("");
    expect(estimateJaccard(empty, empty)).toBe(0);
    expect(estimateJaccard(empty, minhashSignature("some real text goes in here today"))).toBe(0);
    expect(estimateJaccard(new Uint8Array(3), empty)).toBe(0);
  });

  it("handles text shorter than one shingle", () => {
    const sig = minhashSignature("two words");
    expect(estimateJaccard(sig, minhashSignature("two words"))).toBe(1);
  });
});

const joinNew = (ops: readonly DiffOp[]): string =>
  ops
    .filter((op) => op.type !== "del")
    .map((op) => op.text)
    .join("");
const joinOld = (ops: readonly DiffOp[]): string =>
  ops
    .filter((op) => op.type !== "add")
    .map((op) => op.text)
    .join("");

describe("diffWords", () => {
  it("reports equal, deleted and added runs", () => {
    expect(diffWords("take one tablet daily", "take two tablets daily")).toEqual([
      { type: "equal", text: "take " },
      { type: "del", text: "one tablet " },
      { type: "add", text: "two tablets " },
      { type: "equal", text: "daily" },
    ]);
  });

  it("handles identical, empty and one-sided input", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("same text", "same text")).toEqual([{ type: "equal", text: "same text" }]);
    expect(diffWords("", "new text")).toEqual([{ type: "add", text: "new text" }]);
    expect(diffWords("old text", "")).toEqual([{ type: "del", text: "old text" }]);
  });

  it("works on Arabic and mixed-direction text without caring about direction", () => {
    const a = "ي\u064Fؤخذ باراسيتامول 500 مجم كل ست ساعات";
    const b = "ي\u064Fؤخذ باراسيتامول 1000 مجم كل ثماني ساعات";
    const ops = diffWords(a, b);
    expect(joinNew(ops)).toBe(b);
    expect(joinOld(ops)).toBe(a);
    expect(diffStats(ops)).toEqual({ added: 2, removed: 2 });
    expect(ops.filter((op) => op.type === "equal").map((op) => op.text)).toEqual([
      "ي\u064Fؤخذ باراسيتامول ",
      "مجم كل ",
      "ساعات",
    ]);
  });

  it("preserves whitespace and newlines", () => {
    const a = "line one\n\nline  two\tend";
    const b = "line one\n\nline  three\tend";
    const ops = diffWords(a, b);
    expect(joinNew(ops)).toBe(b);
    expect(joinOld(ops)).toBe(a);
  });

  it("reconstructs both sides for random edits", () => {
    const base = prose(5, 300, ENGLISH);
    for (const edits of [1, 5, 20, 80]) {
      const other = edited(base, edits);
      other.splice(40, 3);
      other.splice(120, 0, "inserted", "words");
      const a = base.join(" ");
      const b = other.join(" ");
      const ops = diffWords(a, b);
      expect(joinNew(ops)).toBe(b);
      expect(joinOld(ops)).toBe(a);
    }
  });

  it("produces a minimal diff for a single swap in the middle", () => {
    const base = prose(8, 1_000, ENGLISH);
    const other = [...base];
    other[500] = "REPLACED";
    expect(diffStats(diffWords(base.join(" "), other.join(" ")))).toEqual({ added: 1, removed: 1 });
  });

  it("diffs 30,000 words with scattered edits in under a second", () => {
    const base = prose(31, 30_000, ENGLISH);
    const other = edited(base, 120);
    const a = base.join(" ");
    const b = other.join(" ");
    const started = performance.now();
    const ops = diffWords(a, b);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_000);
    expect(diffStats(ops)).toEqual({ added: 120, removed: 120 });
    expect(joinNew(ops)).toBe(b);
  });

  it("falls back to remove-all/add-all for a total rewrite instead of exhausting memory", () => {
    const a = prose(41, 30_000, ENGLISH).join(" ");
    const b = prose(42, 30_000, ARABIC).join(" ");
    const started = performance.now();
    const ops = diffWords(a, b);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(joinNew(ops)).toBe(b);
    expect(joinOld(ops)).toBe(a);
  });
});

describe("diffStats", () => {
  it("counts words, not characters or runs", () => {
    expect(
      diffStats([
        { type: "equal", text: "keep this " },
        { type: "add", text: "three new words " },
        { type: "del", text: "gone " },
      ]),
    ).toEqual({ added: 3, removed: 1 });
    expect(diffStats([])).toEqual({ added: 0, removed: 0 });
  });
});
