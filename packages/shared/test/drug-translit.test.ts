import { describe, expect, it } from "vitest";

import {
  TRANSLIT_MAX_CANDIDATES,
  arabicToLatinCandidates,
  consonantSkeleton,
} from "../src/drug-translit.js";

/*
 * Arabic spellings of well-known Egyptian brands. Arabic leaves out short vowels and p / v, so the test
 * is whether one of the candidates sounds like the brand: same consonant skeleton (vowels out, c/k/q,
 * b/p, f/ph... folded). Exact spelling is asserted only where the Arabic fixes it.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  ["بانادول", "panadol"],
  ["أوجمنتين", "augmentin"],
  ["اوجمنتين", "augmentin"],
  ["كونكور", "concor"],
  ["ريوبان", "riopan"],
  ["فولتارين", "voltaren"],
  ["نوفالجين", "novalgin"],
  ["كاتافلام", "cataflam"],
  ["بروفين", "brufen"],
  ["فلاجيل", "flagyl"],
  ["سيبرو", "cipro"],
  ["اموكسيل", "amoxil"],
  ["فلوموكس", "flumox"],
  ["انتينال", "antinal"],
  ["ديجستين", "digestin"],
  ["نيكسيوم", "nexium"],
  ["ليبيتور", "lipitor"],
  ["كونجستال", "congestal"],
  ["سيتال", "cetal"],
  ["ادول", "adol"],
  ["اماريل", "amaryl"],
  ["جلوكوفاج", "glucophage"],
  ["فنتولين", "ventolin"],
  ["موتيليوم", "motilium"],
  ["موتيديل", "motidyl"],
  ["ريلاكسون", "relaxon"],
  ["جليبيميت", "glibimet"],
  ["بيبرا", "bepra"],
  ["زيرتك", "zyrtec"],
  ["كلاريتين", "claritin"],
  ["اوتريفين", "otrivin"],
  ["ميوكوسولفان", "mucosolvan"],
  ["فيرولين", "ferolin"],
  ["اكتيفيد", "actifed"],
  ["كومتركس", "comtrex"],
  ["بنادول", "panadol"],
  ["نوروفين", "nurofen"],
  ["ديكلوفين", "diclofen"],
  ["اوفلوكس", "oflox"],
  ["زانتاك", "zantac"],
  ["مالوكس", "maalox"],
  ["جافيسكون", "gaviscon"],
  ["سبازمو", "spasmo"],
  ["بيوتيريكس", "biotrix"],
  ["كلافوكس", "clavox"],
  ["سوليبرا", "solibra"],
  ["ليريكا", "lyrica"],
  ["نيوروبيون", "neurobion"],
  ["بريمبيران", "primperan"],
  ["ستيموسيد", "stimucid"],
  ["اريثروسين", "erythrocin"],
  ["ديكساميثازون", "dexamethasone"],
  ["اسبرين", "aspirin"],
  ["فيتامين", "vitamin"],
  ["كالسيوم", "calcium"],
  ["سيفالكسين", "cephalexin"],
  ["ترامادول", "tramadol"],
  ["ديازيبام", "diazepam"],
  ["اومبرازول", "omeprazole"],
  ["ميترونيدازول", "metronidazole"],
  ["كلوبيدوجريل", "clopidogrel"],
  ["الفولتارين", "voltaren"],
  ["الكونكور", "concor"],
];

describe("arabicToLatinCandidates", () => {
  it("has at least 60 real brand pairs", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(PAIRS)("%s sounds like %s", (arabic, latin) => {
    const candidates = arabicToLatinCandidates(arabic);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(TRANSLIT_MAX_CANDIDATES);
    const wanted = consonantSkeleton(latin);
    expect(
      candidates.map((candidate) => consonantSkeleton(candidate)),
      `${arabic} -> ${candidates.join(", ")}`,
    ).toContain(wanted);
  });

  it("spells out what Arabic fixes", () => {
    expect(arabicToLatinCandidates("بانادول")).toContain("panadol");
    expect(arabicToLatinCandidates("بانادول")[0]).toBe("banadol");
    expect(arabicToLatinCandidates("ريوبان")).toContain("riopan");
    expect(arabicToLatinCandidates("اوجمنتين")).toContain("augmentin");
    expect(arabicToLatinCandidates("كونكور")).toContain("konkor");
  });

  it("drops the article", () => {
    expect(arabicToLatinCandidates("الفولتارين")).toEqual(arabicToLatinCandidates("فولتارين"));
  });

  it("ignores tashkeel, tatweel and non-Arabic characters", () => {
    expect(arabicToLatinCandidates("بَانَادُول")).toEqual(arabicToLatinCandidates("بانادول"));
    expect(arabicToLatinCandidates("بانـادول")).toEqual(arabicToLatinCandidates("بانادول"));
    expect(arabicToLatinCandidates("بانادول 500 mg")).toEqual(arabicToLatinCandidates("بانادول"));
  });

  it("returns nothing for text without Arabic letters or an absurdly long one", () => {
    expect(arabicToLatinCandidates("")).toEqual([]);
    expect(arabicToLatinCandidates("panadol 500")).toEqual([]);
    expect(arabicToLatinCandidates("ب".repeat(80))).toEqual([]);
  });

  it("gives distinct lowercase candidates, at most four, deterministically", () => {
    for (const [arabic] of PAIRS) {
      const candidates = arabicToLatinCandidates(arabic);
      expect(new Set(candidates).size).toBe(candidates.length);
      expect(candidates.every((candidate) => candidate === candidate.toLowerCase())).toBe(true);
      expect(arabicToLatinCandidates(arabic)).toEqual(candidates);
    }
  });

  it("keeps two words apart", () => {
    expect(arabicToLatinCandidates("بانادول اكسترا")[0]).toContain(" ");
  });
});

describe("consonantSkeleton", () => {
  it("folds sounds that Arabic or handwriting do not tell apart", () => {
    expect(consonantSkeleton("Panadol")).toBe(consonantSkeleton("banadul"));
    expect(consonantSkeleton("concor")).toBe(consonantSkeleton("konkor"));
    expect(consonantSkeleton("physio")).toBe(consonantSkeleton("fizio"));
  });
});
