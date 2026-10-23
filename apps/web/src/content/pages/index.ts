import { about } from "./about";
import { aboutEn } from "./about.en";
import { aiAssistant } from "./ai-assistant";
import { aiAssistantEn } from "./ai-assistant.en";
import { clinics } from "./clinics";
import { clinicsEn } from "./clinics.en";
import { doctors } from "./doctors";
import { doctorsEn } from "./doctors.en";
import { editorialPolicy } from "./editorial-policy";
import { editorialPolicyEn } from "./editorial-policy.en";
import { handwrittenPrescriptions } from "./handwritten-prescriptions";
import { handwrittenPrescriptionsEn } from "./handwritten-prescriptions.en";
import { medicalReview } from "./medical-review";
import { medicalReviewEn } from "./medical-review.en";
import { medicineExplainer } from "./medicine-explainer";
import { medicineExplainerEn } from "./medicine-explainer.en";
import { patients } from "./patients";
import { patientsEn } from "./patients.en";
import { pharmacists } from "./pharmacists";
import { pharmacistsEn } from "./pharmacists.en";
import { prescriptionReader } from "./prescription-reader";
import { prescriptionReaderEn } from "./prescription-reader.en";
import { sources } from "./sources";
import { sourcesEn } from "./sources.en";

import type { ProductPageContent } from "./types";
import type { Locale } from "../../lib/locale";

/** The `PUBLIC_PAGES` keys of the twelve product and trust pages (each has an Arabic and an English file). */
export const PRODUCT_PAGE_CONTENT = {
  featurePrescriptionReader: { ar: prescriptionReader, en: prescriptionReaderEn },
  featureHandwrittenPrescriptions: { ar: handwrittenPrescriptions, en: handwrittenPrescriptionsEn },
  featureMedicineExplainer: { ar: medicineExplainer, en: medicineExplainerEn },
  featureAiAssistant: { ar: aiAssistant, en: aiAssistantEn },
  forPharmacists: { ar: pharmacists, en: pharmacistsEn },
  forClinics: { ar: clinics, en: clinicsEn },
  forDoctors: { ar: doctors, en: doctorsEn },
  forPatients: { ar: patients, en: patientsEn },
  about: { ar: about, en: aboutEn },
  editorialPolicy: { ar: editorialPolicy, en: editorialPolicyEn },
  medicalReview: { ar: medicalReview, en: medicalReviewEn },
  sources: { ar: sources, en: sourcesEn },
} as const satisfies Record<string, Record<Locale, ProductPageContent>>;

export type ProductPageKey = keyof typeof PRODUCT_PAGE_CONTENT;

/** Trust pages carry no sign-up call to action and no `about` topic in their structured data. */
export const TRUST_PAGE_KEYS: readonly ProductPageKey[] = [
  "about",
  "editorialPolicy",
  "medicalReview",
  "sources",
];

export function productPageContent(key: ProductPageKey, locale: Locale): ProductPageContent {
  return PRODUCT_PAGE_CONTENT[key][locale];
}
