/*
 * Arabic-script drug names (ريوبان, بانادول) to the Latin spellings a database would hold them under.
 * Arabic leaves short vowels out and has no p / v / g sound of its own, so one name has many Latin
 * readings; this returns the few most likely ones (best first) and leaves the rest to the fuzzy
 * matcher, which compares sounds (double metaphone) and trigrams, not letters. Pure and
 * dependency-free. A candidate found this way is a guess: the decision never auto-accepts it.
 */

/** Most candidates returned. */
export const TRANSLIT_MAX_CANDIDATES = 4;

const MAX_LETTERS = 40;

type Option = readonly [latin: string, cost: number];
type Slot = readonly Option[];

/** Tashkeel (U+064B-U+0652), superscript alef (U+0670), tatweel (U+0640). */
const MARKS = /[ً-ْٰـ]/g;

const FIXED = (latin: string): Slot => [[latin, 0]];

const CONSONANTS: Readonly<Record<string, Slot>> = {
  // Arabic has no p: in pharmacy names a ب is as often a p as a b.
  ب: [
    ["b", 0],
    ["p", 0.5],
  ],
  پ: FIXED("p"),
  ت: FIXED("t"),
  ث: [
    ["th", 0],
    ["s", 1],
    ["t", 1],
  ],
  ج: [
    ["g", 0],
    ["j", 1],
  ],
  چ: FIXED("ch"),
  ح: FIXED("h"),
  خ: [
    ["kh", 0],
    ["k", 1],
  ],
  د: FIXED("d"),
  ذ: [
    ["z", 0],
    ["th", 1],
    ["d", 1],
  ],
  ر: FIXED("r"),
  ز: FIXED("z"),
  س: [
    ["s", 0],
    ["c", 1],
  ],
  ش: FIXED("sh"),
  ص: FIXED("s"),
  ض: FIXED("d"),
  ط: FIXED("t"),
  ظ: FIXED("z"),
  غ: [
    ["gh", 0],
    ["g", 1],
  ],
  ف: [
    ["f", 0],
    ["ph", 1],
  ],
  ڤ: FIXED("v"),
  ق: [
    ["k", 0],
    ["q", 1],
    ["c", 1],
  ],
  ك: [
    ["k", 0],
    ["c", 1],
  ],
  گ: FIXED("g"),
  ل: FIXED("l"),
  م: FIXED("m"),
  ن: FIXED("n"),
  ع: [
    ["a", 0],
    ["", 1],
  ],
  ء: FIXED(""),
};

const ALEFS = new Set(["ا", "أ", "إ", "آ", "ٱ"]);

/** The options of one letter, given its neighbours (`previous` letter, position in the word). */
function slotFor(letter: string, previous: string | undefined, isFirst: boolean, isLast: boolean): Slot {
  const consonant = CONSONANTS[letter];
  if (consonant !== undefined) return consonant;
  switch (letter) {
    case "ا":
    case "ٱ":
      if (isFirst)
        return [
          ["a", 0],
          ["e", 1],
          ["i", 2],
        ];
      return isLast
        ? [
            ["a", 0],
            ["", 1],
          ]
        : [
            ["a", 0],
            ["", 2],
          ];
    case "أ":
    case "آ":
      return [
        ["a", 0],
        ["e", 1],
      ];
    case "إ":
      return [
        ["i", 0],
        ["e", 1],
      ];
    case "و":
    case "ؤ":
      if (isFirst)
        return [
          ["w", 0],
          ["o", 1],
          ["u", 1],
        ];
      if (previous !== undefined && ALEFS.has(previous))
        return [
          ["u", 0],
          ["o", 1],
        ];
      return isLast
        ? [
            ["o", 0],
            ["u", 1],
          ]
        : [
            ["o", 0],
            ["u", 1],
            ["w", 2],
          ];
    case "ي":
    case "ى":
    case "ئ":
      if (letter === "ى" && isLast)
        return [
          ["a", 0],
          ["i", 1],
        ];
      return [
        ["i", 0],
        ["y", 1],
        ["e", 1],
      ];
    case "ة":
      return [
        ["a", 0],
        ["e", 1],
      ];
    case "ه":
      return isLast
        ? [
            ["a", 0],
            ["e", 1],
            ["h", 1],
          ]
        : [
            ["h", 0],
            ["", 1],
          ];
    default:
      return [];
  }
}

const LATIN_VOWEL = /[aeiouy]/;

/** "gmnt" has no vowel to say it by: put an "e" before the last consonant of a run of three or more. */
function vowelized(text: string): string {
  return text
    .split(" ")
    .map((word) =>
      word.replace(/[^aeiouy]{3,}/g, (run) =>
        run.length >= 4
          ? `${run.slice(0, run.length - 2)}e${run.slice(run.length - 2)}`
          : `${run.slice(0, run.length - 1)}e${run.slice(run.length - 1)}`,
      ),
    )
    .join(" ");
}

function wordSlots(word: string): Slot[] {
  let letters = [...word];
  // The article is dropped when something substantial follows: الفولتارين is Voltaren.
  if (letters.length >= 5 && ALEFS.has(letters[0] ?? "") && letters[1] === "ل") {
    letters = letters.slice(2);
  }
  const slots: Slot[] = [];
  letters.forEach((letter, index) => {
    const slot = slotFor(letter, letters[index - 1], index === 0, index === letters.length - 1);
    if (slot.length > 0) slots.push(slot);
  });
  return slots;
}

/**
 * Up to 4 Latin spellings (lowercase, best first) of an Arabic-script drug name. Letters that are not
 * Arabic are ignored; text with no Arabic letter gives `[]`. Deterministic.
 */
export function arabicToLatinCandidates(text: string): string[] {
  const cleaned = text
    .replace(MARKS, "")
    .replace(/[٠-٩۰-۹]/g, " ")
    .replace(/[^؀-ۿݐ-ݿ]+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0 || [...cleaned].filter((c) => c !== " ").length > MAX_LETTERS) return [];

  const slots: Slot[] = [];
  words.forEach((word, index) => {
    if (index > 0) slots.push(FIXED(" "));
    slots.push(...wordSlots(word));
  });
  if (slots.length === 0) return [];

  // Best-first over the choice vectors: the cheapest spelling first, then each single deviation.
  const render = (choice: readonly number[]): string =>
    slots.map((slot, i) => slot[choice[i] ?? 0]?.[0] ?? "").join("");
  const costOf = (choice: readonly number[]): number =>
    slots.reduce((sum, slot, i) => sum + (slot[choice[i] ?? 0]?.[1] ?? 0), 0);

  const start = slots.map(() => 0);
  const queue: { choice: number[]; cost: number }[] = [{ choice: start, cost: 0 }];
  const seenChoices = new Set<string>([start.join(",")]);
  const out: string[] = [];
  const seenText = new Set<string>();
  let expansions = 0;
  while (queue.length > 0 && out.length < TRANSLIT_MAX_CANDIDATES - 1 && expansions < 400) {
    expansions++;
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current === undefined) break;
    const rendered = render(current.choice).replace(/\s+/g, " ").trim();
    if (rendered !== "" && !seenText.has(rendered)) {
      seenText.add(rendered);
      out.push(rendered);
    }
    slots.forEach((slot, i) => {
      const next = [...current.choice];
      next[i] = (next[i] ?? 0) + 1;
      if (next[i] === undefined || next[i] >= slot.length) return;
      const key = next.join(",");
      if (seenChoices.has(key)) return;
      seenChoices.add(key);
      queue.push({ choice: next, cost: costOf(next) });
    });
  }

  // A spelling with vowels where Arabic left none, tried second: it is the likeliest real shape.
  const first = out[0];
  if (first !== undefined) {
    const spoken = vowelized(first);
    if (spoken !== first && LATIN_VOWEL.test(spoken) && !seenText.has(spoken)) {
      out.splice(1, 0, spoken);
    }
  }
  return out.slice(0, TRANSLIT_MAX_CANDIDATES);
}

/** Letters-only skeleton of a Latin name (vowels out, c/q→k, ph→f, ...): what two spellings share. */
export function consonantSkeleton(latin: string): string {
  return latin
    .toLowerCase()
    .replace(/c(?=[eiy])/g, "s")
    .replace(/x/g, "ks")
    .replace(/ph/g, "f")
    .replace(/gh|kh/g, "k")
    .replace(/sh/g, "x")
    .replace(/th/g, "t")
    .replace(/[cq]/g, "k")
    .replace(/[pb]/g, "p")
    .replace(/[jg]/g, "k")
    .replace(/[vw]/g, "f")
    .replace(/[zs]/g, "s")
    .replace(/[aeiouyh]/g, "")
    .replace(/(.)\1+/g, "$1")
    .replace(/[^a-z0-9]/g, "");
}
