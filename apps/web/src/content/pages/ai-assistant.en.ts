import type { ProductPageContent } from "./types";

/** Feature page: the Arabic AI medical assistant (English). */
export const aiAssistantEn: ProductPageContent = {
  meta: {
    title: "Arabic AI Medical Assistant for Medicines",
    description:
      "Ask about any medicine in Arabic and get a plain answer, with skills for drugs, interactions and labs. It never diagnoses or replaces a pharmacist.",
  },
  hero: {
    eyebrow: "AI medical assistant",
    h1: "An Arabic AI medical assistant: ask about your medication",
    lead: "A medical chat in Arabic that explains medicines and organizes what you know, and says plainly when to ask your pharmacist or doctor.",
    cta: { label: "Start with a free account", href: "/register" },
  },
  answer:
    "The Wasfa AI medical assistant is an Arabic medical chat. You ask in formal or colloquial Arabic about a medicine, a dose, an interaction or a test result, and it replies in plain words, listing sources when it searches. It is not a doctor or pharmacist, never diagnoses or prescribes, and says when to ask a professional.",
  sections: [
    {
      id: "what",
      heading: "What is the Wasfa AI medical assistant?",
      body: [
        "It is a conversation in Arabic inside your account. You type a question and the answer streams in as it is written, and your chats are saved in a history you can return to. It is connected to the rest of the product, so after your prescription is analyzed you can ask about any medicine in it.",
        "It is not a general chatbot that talks about everything. It is a medical assistant that handles drug information carefully and separates what it can explain from what needs a doctor's judgment.",
      ],
    },
    {
      id: "skills",
      heading: "Focused skills instead of an open question",
      body: [
        "You can pick a skill before you ask, so the answer is more focused. The skills available in the chat are:",
      ],
      bullets: [
        "Drug information: usual use, common side effects and general precautions.",
        "Drug interactions: a heads-up about medicines that may conflict, so you can ask your pharmacist.",
        "Dose calculator: helps work out a dose so you can check the result with a professional.",
        "Lab test explanation: a simple, educational reading of test results.",
        "Imaging report explanation: educational help with the report's terms, not a substitute for the doctor's reading.",
      ],
    },
    {
      id: "not-pharmacist",
      heading: "Is it a substitute for asking a pharmacist?",
      body: [
        "No, and that is deliberate. Many people look for a way to ask a pharmacist online. The assistant gives you quick general information at any hour, but it is not a pharmacist and does not know your medical history or what you actually take.",
        "When your question touches a treatment decision, such as changing a dose, combining two medicines or new symptoms, it suggests asking your pharmacist or doctor. In an emergency, do not wait for any app: call the emergency services.",
      ],
    },
    {
      id: "trust",
      heading: "How do we reduce mistakes?",
      body: [
        "We treat medicine answers with caution: sources are shown under the answer when the assistant searches, it avoids certainty where certainty is not warranted, and the medical disclaimer is always within reach. Even so, any AI model can be wrong, so check important information with a professional before you act on it.",
        "You can delete your account at any time, and the privacy policy explains what we collect and why.",
      ],
    },
  ],
  faq: [
    {
      q: "Can I ask in Egyptian or Gulf Arabic?",
      a: "Yes. Write the way you normally do and the assistant will understand, replying in simple Arabic.",
    },
    {
      q: "Does the assistant diagnose my condition?",
      a: "No. It explains general information and does not diagnose or prescribe. Take your condition to your doctor.",
    },
    {
      q: "Can I rely on it for doses?",
      a: "Do not change a dose because of it. Follow what your doctor wrote or your pharmacist confirmed, and use the assistant to understand.",
    },
    {
      q: "Are my questions and chats private?",
      a: "Your chats are stored in your account. We collect the minimum data needed and explain it in the privacy policy, so do not type passwords or details you do not need to share.",
    },
  ],
  related: [
    "/features/medicine-explainer",
    "/features/prescription-reader",
    "/for/patients",
    "/for/pharmacists",
    "/pricing",
  ],
  updatedAt: "2026-10-20",
};
