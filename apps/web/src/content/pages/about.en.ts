// DRAFT — needs owner approval (phase4 WP2 step 8).
import type { ProductPageContent } from "./types";

/** Trust page: About Wasfa AI (English). */
export const aboutEn: ProductPageContent = {
  meta: {
    title: "About Wasfa AI: an Arabic Prescription Assistant",
    description:
      "Wasfa AI is an Arabic AI medical assistant that reads a photographed prescription and explains medicines in plain language. Who it is for and its limits.",
  },
  hero: {
    eyebrow: "About Wasfa AI",
    h1: "About Wasfa AI: an Arabic assistant for understanding prescriptions",
    lead: "A short reference page: what Wasfa AI is, who it is for, where its limits are and how to reach us.",
    cta: { label: "Contact us", href: "/contact" },
  },
  answer:
    "Wasfa AI is an Arabic-first AI medical assistant. It reads a photographed prescription, handwritten or printed, and turns it into a clear card of medicine names, doses, frequency and warnings, and it answers medicine questions in plain language. It helps you understand; it does not diagnose, prescribe or replace a doctor or pharmacist.",
  sections: [
    {
      id: "what",
      heading: "What is Wasfa AI?",
      body: [
        'Wasfa AI ("وصفة AI" in Arabic) is a web app that runs in the browser, with a fully right-to-left Arabic interface. It reads a prescription from an image or a PDF and checks its own reading with a second reading, a match against a medicines database and a confidence score for each line, then shows you the result and flags whatever it is unsure of.',
        "It also includes an Arabic medical assistant you can ask about medicines, and tools for pharmacies and clinics to organize their work through organizations with teams and roles.",
      ],
    },
    {
      id: "for-whom",
      heading: "Who is it for?",
      body: [
        "For patients and families who want to understand their medicines, for pharmacists who want to read difficult handwriting quickly, for doctors, and for pharmacies and clinics that want a system for their team. Its terms and examples speak to users in Egypt and the Gulf.",
      ],
    },
    {
      id: "not",
      heading: "What does it not do?",
      body: [
        "It does not diagnose illness, prescribe or dispense treatment, replace a doctor or pharmacist, or serve emergencies. Its automatic reading can be wrong, which is why it flags what it is unsure of and asks you to check. The medical disclaimer has the details.",
      ],
    },
    {
      id: "trust",
      heading: "How do we judge what we publish?",
      body: [
        "We write and review what we publish under the editorial policy, describe the medical review process on its own page, and set out our source policy on the sources page. A separate privacy policy explains what we collect and why, and you can delete your account at any time.",
      ],
    },
    {
      id: "contact",
      heading: "How can you reach us?",
      body: [
        "For questions, support, feedback and corrections to anything on our pages, use the contact page, which lists the available channels and a message form. Please do not send medical data or passwords in your message, and in an emergency call the emergency services.",
      ],
    },
  ],
  faq: [],
  related: ["/editorial-policy", "/medical-review", "/sources", "/contact"],
  updatedAt: "2026-10-20",
};
