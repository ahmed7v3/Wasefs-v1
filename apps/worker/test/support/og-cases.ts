import sharp from "sharp";

import { OG_RENDERERS } from "../../src/og/render.js";

import type { OgAssets } from "../../src/og/templates/index.js";
import type { OgTemplateId } from "@wasfa/shared/schemas/og";

/** A stand-in for a library image: a diagonal gradient with a few shapes, so crops are visible. */
export async function fakePhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#60a5fa"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1100" cy="300" r="180" fill="#ffffff" fill-opacity="0.6"/><rect x="200" y="450" width="500" height="300" rx="40" fill="#e6f1fe"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

export interface OgCase {
  name: string;
  template: OgTemplateId;
  input: unknown;
  withImage?: "cover" | "photo";
}

const SHA = "a".repeat(64);

/** One card per template (Arabic) and the English `page`: the snapshots under `test/__og__`. */
export const OG_CASES: readonly OgCase[] = [
  {
    name: "page-ar",
    template: "page",
    input: {
      locale: "ar",
      title: "افهم روشتتك في ثوانٍ",
      subtitle: "مساعدك الطبي الذكي لتحليل الروشتات",
    },
  },
  {
    name: "page-en",
    template: "page",
    input: {
      locale: "en",
      title: "Understand your prescription in seconds",
      subtitle: "Your smart medical assistant",
    },
  },
  {
    name: "article-ar",
    template: "article",
    input: {
      locale: "ar",
      title: "كيف تقرأ جرعات الدواء على الروشتة بثقة وتتجنب الأخطاء الشائعة",
      category: "صحة الدواء",
      authorName: "د. سارة محمود",
      cover: { sha256: SHA, focalX: 70, focalY: 40 },
    },
    withImage: "cover",
  },
  {
    name: "guide-ar",
    template: "guide",
    input: { locale: "ar", title: "دليل المريض لفهم الروشتة الطبية خطوة بخطوة", sectionCount: 7 },
  },
  {
    name: "glossary-ar",
    template: "glossary",
    input: { locale: "ar", term: "BID", meaning: "مرتين يوميًا، كل اثنتي عشرة ساعة" },
  },
  {
    name: "drug-ar",
    template: "drug",
    input: {
      locale: "ar",
      nameAr: "أموكسيل",
      nameEn: "Amoxil",
      activeIngredient: "أموكسيسيلين",
      drugClass: "مضاد حيوي",
      dosageForm: "capsule",
    },
  },
  {
    name: "author-ar",
    template: "author",
    input: {
      locale: "ar",
      name: "د. سارة محمود",
      credentials: "صيدلانية إكلينيكية، مراجعة طبية للمحتوى الدوائي",
      photo: { sha256: SHA, focalX: 50, focalY: 35 },
    },
    withImage: "photo",
  },
];

export async function renderCase(
  ogCase: OgCase,
): Promise<Awaited<ReturnType<(typeof OG_RENDERERS)[OgTemplateId]>>> {
  const assets: OgAssets = {};
  if (ogCase.withImage !== undefined) assets[ogCase.withImage] = await fakePhoto();
  return OG_RENDERERS[ogCase.template](ogCase.input, assets);
}
