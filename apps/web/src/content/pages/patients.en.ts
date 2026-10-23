import type { ProductPageContent } from "./types";

/** Audience page: patients and their families (English). */
export const patientsEn: ProductPageContent = {
  meta: {
    title: "Understand My Medications from My Prescription",
    description:
      "Understand your medicines and doses before you leave the pharmacy: photograph the prescription, read a clear Arabic card and ask about any medicine.",
  },
  hero: {
    eyebrow: "For patients and families",
    h1: "Understand my medications: know what is on your prescription",
    lead: "Photograph the prescription, read your medicines and doses in Arabic, ask what you do not understand, and never take something you do not know.",
    cta: { label: "Create your free account", href: "/register" },
  },
  answer:
    "Wasfa AI helps you understand your medications. Photograph a prescription and it reads it into an Arabic card of medicine names, doses, frequency and duration, with a plain explanation, flagging uncertain lines for your pharmacist. You can ask about any medicine in Arabic. It does not diagnose or replace your doctor or pharmacist.",
  sections: [
    {
      id: "problem",
      heading: "Why do we need to understand a prescription?",
      body: [
        "A prescription is handed over in a rush, in handwriting you cannot read and Latin names you do not know. At the pharmacy someone explains in seconds how to take a medicine, and by the time you are home you have forgotten: every eight hours, or three times a day? Before food, or after?",
        "Mistakes in taking medicine are a real problem, and understanding is the first protection against them. That is why Wasfa AI turns a prescription into something you can read, understand and come back to.",
      ],
    },
    {
      id: "how",
      heading: "How does Wasfa AI help?",
      body: [
        "You photograph the prescription with your phone or upload a PDF, and you get an Arabic card for each medicine on it: name, strength, dose, frequency and duration. Under each medicine is a simple note about what it is usually used for, its common side effects and its general precautions.",
        "If a line is unclear we will not guess for you. We put a review mark on it so you can ask your pharmacist or doctor. Every prescription is saved in your history, and you can print it or send it to a family member on WhatsApp.",
      ],
      bullets: [
        "A clear Arabic card of medicine names and doses.",
        "A simple explanation for each medicine in everyday words.",
        "A review mark on uncertain lines.",
        "A history of past prescriptions, with printing and sharing.",
      ],
    },
    {
      id: "ask",
      heading: "Ask in your own words",
      body: [
        "If something is unclear, ask the assistant in Arabic, formal or colloquial, about any medicine: what it does, what its common side effects are, and whether there is a warning about mixing it with another medicine that you should raise with your pharmacist. It will tell you plainly when your question is one for your doctor or pharmacist.",
      ],
    },
    {
      id: "safety",
      heading: "What to always remember",
      body: [
        "Do not stop a medicine, change a dose or add a medicine because of anything you read here. Ask your doctor or pharmacist first. Wasfa AI does not diagnose your condition. And if you have severe symptoms after taking a medicine, such as difficulty breathing, swelling or a severe rash, call the emergency services at once and do not wait for an app to answer.",
      ],
    },
  ],
  faq: [
    {
      q: "Can I collect my medicine based on what Wasfa AI read?",
      a: "No. It is an automatic reading that can be wrong. Show the original prescription to the pharmacist and use the result to understand and to ask questions.",
    },
    {
      q: "Is it suitable for older people and their families?",
      a: "Yes. The interface is clear and in Arabic, and a family member can photograph the prescription and print the result or send it on WhatsApp.",
    },
    {
      q: "Does it keep my prescriptions?",
      a: "They are kept in private storage tied to your account and a summary appears in your history. You can delete your account at any time, and the privacy policy has the details.",
    },
  ],
  related: [
    "/features/prescription-reader",
    "/features/medicine-explainer",
    "/features/ai-assistant",
    "/pricing",
    "/contact",
  ],
  updatedAt: "2026-10-20",
};
