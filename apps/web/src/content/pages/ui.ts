import type { Locale } from "../../lib/locale";

/*
 * The fixed strings of the product-page template (the page copy itself lives in `<slug>.ts` and
 * `<slug>.en.ts`). Same shape in both languages, so the component stays locale-agnostic.
 */

export interface ProductPageUi {
  breadcrumbLabel: string;
  breadcrumbHome: string;
  updated: string;
  faqTitle: string;
  faqLead: string;
  relatedTitle: string;
  /** Safety line under every page: the product never replaces a pharmacist or doctor (AGENT.md §5.11). */
  safetyNote: string;
  disclaimerLink: string;
  contactCta: string;
  /** Short link labels of the pages a page can point to, keyed by locale-neutral path. */
  links: Record<string, string>;
}

const ar: ProductPageUi = {
  breadcrumbLabel: "مسار الصفحة",
  breadcrumbHome: "الرئيسية",
  updated: "آخر تحديث",
  faqTitle: "أسئلة شائعة",
  faqLead: "إجابات مختصرة عن أكثر ما يسأل عنه الناس في هذا الموضوع.",
  relatedTitle: "اقرأ أيضًا",
  safetyNote:
    "وصفة AI تشرح وتنظّم المعلومات ولا تشخّص ولا تصرف علاجًا ولا تحل محل الطبيب أو الصيدلي. راجع المختص قبل أي قرار علاجي، وفي الطوارئ اتصل بالإسعاف.",
  disclaimerLink: "إخلاء المسؤولية الطبية",
  contactCta: "تواصل معنا",
  links: {
    "/features/prescription-reader": "قراءة الروشتة بالذكاء الاصطناعي",
    "/features/handwritten-prescriptions": "قراءة خط الدكتور",
    "/features/medicine-explainer": "شرح الدواء والروشتة",
    "/features/ai-assistant": "المساعد الطبي الذكي",
    "/for/pharmacists": "للصيادلة",
    "/for/clinics": "للعيادات",
    "/for/doctors": "للأطباء",
    "/for/patients": "للمرضى وأسرهم",
    "/about": "عن وصفة AI",
    "/editorial-policy": "السياسة التحريرية",
    "/medical-review": "المراجعة الطبية",
    "/sources": "المصادر",
    "/pricing": "الأسعار والخطط",
    "/contact": "تواصل معنا",
    "/disclaimer": "إخلاء المسؤولية الطبية",
    "/privacy": "سياسة الخصوصية",
  },
};

const en: ProductPageUi = {
  breadcrumbLabel: "Breadcrumb",
  breadcrumbHome: "Home",
  updated: "Last updated",
  faqTitle: "Frequently asked questions",
  faqLead: "Short answers to what people ask most about this topic.",
  relatedTitle: "Read next",
  safetyNote:
    "Wasfa AI explains and organizes information. It does not diagnose, prescribe or replace your doctor or pharmacist. Check with a professional before any treatment decision, and call emergency services in an emergency.",
  disclaimerLink: "Medical disclaimer (Arabic)",
  contactCta: "Contact us",
  links: {
    "/features/prescription-reader": "AI prescription reader",
    "/features/handwritten-prescriptions": "Reading doctors' handwriting",
    "/features/medicine-explainer": "Medicine and prescription explainer",
    "/features/ai-assistant": "AI medical assistant",
    "/for/pharmacists": "For pharmacists",
    "/for/clinics": "For clinics",
    "/for/doctors": "For doctors",
    "/for/patients": "For patients and families",
    "/about": "About Wasfa AI",
    "/editorial-policy": "Editorial policy",
    "/medical-review": "Medical review",
    "/sources": "Sources",
    "/pricing": "Pricing and plans (Arabic)",
    "/contact": "Contact us",
    "/disclaimer": "Medical disclaimer (Arabic)",
    "/privacy": "Privacy policy (Arabic)",
  },
};

export function productPageUi(locale: Locale): ProductPageUi {
  return locale === "en" ? en : ar;
}
