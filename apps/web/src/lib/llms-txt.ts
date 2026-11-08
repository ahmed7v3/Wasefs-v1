import { fromMinor } from "@wasfa/shared/money";

import { PUBLIC_PAGES, type PublicPageKey } from "./seo";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { PublicSettings } from "@wasfa/shared/settings";

/*
 * `/llms.txt` (llmstxt.org format, SEO-GEO §10.5). English on purpose: it is read by machines, and
 * the page list carries both language URLs. Facts mirror the landing copy; nothing is promised that
 * the product does not do.
 */

const PAGE_LABELS: Record<PublicPageKey, string> = {
  home: "Home",
  pricing: "Pricing",
  contact: "Contact",
  privacy: "Privacy policy",
  terms: "Terms of use",
  disclaimer: "Medical disclaimer",
  featurePrescriptionReader: "AI prescription reader",
  featureHandwrittenPrescriptions: "Handwritten prescriptions",
  featureMedicineExplainer: "Medicine explainer",
  featureAiAssistant: "AI medical assistant",
  forPharmacists: "For pharmacists",
  forClinics: "For clinics",
  forDoctors: "For doctors",
  forPatients: "For patients",
  about: "About Wasfa AI",
  editorialPolicy: "Editorial policy",
  medicalReview: "Medical review",
  sources: "Sources",
};

const POLICY_KEYS: readonly PublicPageKey[] = ["privacy", "terms", "disclaimer"];

function links(key: PublicPageKey, siteUrl: string): string {
  const page = PUBLIC_PAGES[key];
  const abs = (path: string): string => new URL(path, siteUrl).toString();
  const ar = `- [${PAGE_LABELS[key]} (Arabic)](${abs(page.path)})`;
  return page.pathEn ? `${ar}\n- [${PAGE_LABELS[key]} (English)](${abs(page.pathEn)})` : ar;
}

/**
 * Answer-first plan facts: the free allowance from the settings, the paid plans (monthly credits and
 * the lowest monthly price) from the catalog the pricing page shows. No catalog (API down): only the
 * free allowance, never a stale or invented price.
 */
export function planFacts(settings: PublicSettings, catalog: CatalogResponse | null): string[] {
  const free = settings.free_tier.monthlyAnalyses;
  const lines = [
    `- Free plan: ${free} prescription analyses per month, no payment details needed.`,
  ];
  for (const plan of catalog?.plans ?? []) {
    const monthly = plan.prices.find((price) => price.months === 1);
    const price = monthly
      ? `${fromMinor(monthly.display.headlineMinor, catalog?.currency ?? "")} ${catalog?.currency ?? ""} per month`
      : "see the pricing page";
    lines.push(`- ${plan.names.en}: ${plan.monthlyCredits} credits per month, ${price}.`);
  }
  return lines;
}

export function buildLlmsTxt(
  settings: PublicSettings,
  siteUrl: string,
  catalog: CatalogResponse | null = null,
): string {
  const keyPages = (Object.keys(PUBLIC_PAGES) as PublicPageKey[]).filter(
    (key) => !POLICY_KEYS.includes(key),
  );
  return [
    `# ${settings.branding.nameEn}`,
    "",
    "> An Arabic-first AI medical assistant that reads photographed prescriptions and explains the medicines, doses and warnings in plain language.",
    "",
    "Users upload a photo of a handwritten or printed prescription and get a clear analysis of each medicine, its dose and relevant warnings, and can ask follow-up questions in Arabic. The service explains information; it does not diagnose, prescribe or replace a doctor or pharmacist.",
    "",
    "## Plans",
    "",
    ...planFacts(settings, catalog),
    "",
    "## Key pages",
    "",
    ...keyPages.map((key) => links(key, siteUrl)),
    "",
    "## Policies",
    "",
    ...POLICY_KEYS.map((key) => links(key, siteUrl)),
    "",
  ].join("\n");
}
