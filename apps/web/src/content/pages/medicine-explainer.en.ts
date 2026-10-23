import type { ProductPageContent } from "./types";

/** Feature page: medicine and prescription explainer (English). */
export const medicineExplainerEn: ProductPageContent = {
  meta: {
    title: "Explain My Prescription, Medicine by Medicine",
    description:
      "Understand each medicine on your prescription: what it is used for, how it was prescribed, common side effects and precautions. Plain Arabic, no diagnosis.",
  },
  hero: {
    eyebrow: "Prescription and medicine explainer",
    h1: "Explain my prescription: medicine by medicine, in plain Arabic",
    lead: "Once your prescription is read, Wasfa AI explains each medicine in everyday language and answers your questions in Arabic.",
    cta: { label: "Create your free account", href: "/register" },
  },
  answer:
    "Wasfa AI explains a prescription one medicine at a time in Arabic: what the medicine is usually used for, how it was prescribed to you in dose, frequency and duration, and its common side effects and general precautions. You can ask the assistant about any medicine too. It is educational and never replaces your doctor or pharmacist.",
  sections: [
    {
      id: "what-it-explains",
      heading: "What does the explainer tell you?",
      body: [
        "When your prescription result appears, each medicine comes with a short plain-language explanation next to its details. It covers what the medicine is usually used for, its common side effects and the general precautions that go with it.",
        "This is general information about the medicine, not an assessment of your case. Only your doctor knows why this medicine was chosen for you, and your pharmacist knows what suits the other medicines you take.",
      ],
      bullets: [
        "Name, strength and form as read from the prescription.",
        "Dose, frequency, duration and route.",
        "The usual purpose of the medicine, in one clear sentence.",
        "Common side effects and general precautions without jargon.",
      ],
    },
    {
      id: "ask",
      heading: '"What does this medicine do?" Ask in your own words',
      body: [
        'Next to the prescription card is a medical assistant you can write to in Arabic, formal or colloquial: "What does this medicine do?", "Before food or after?", "What is the difference between these two names?". It answers in simple wording and a clear order.',
        "When the assistant searches for sources to answer you, they are listed under the answer so you can open them and check for yourself. And if your question needs a clinical judgment about your case, it will ask you to see your doctor or pharmacist rather than answer what it cannot know.",
      ],
    },
    {
      id: "translate",
      heading: "From Latin-letter drug names to an explanation in Arabic",
      body: [
        "Many prescriptions write drug names in English, leaving the patient with names they cannot place. Wasfa AI reads those names and gives you the result and the explanation in Arabic, so the prescription becomes a card you can read and understand without a word-for-word translation.",
        "Note that we do not translate the prescription line by line. We extract the medicines and their details and explain them, and if we are unsure of a drug name we flag it rather than explain it with confidence.",
      ],
    },
    {
      id: "limits",
      heading: "What the explainer does not do",
      body: [
        "It does not diagnose your condition, change a dose, swap one medicine for another, or tell you to stop or continue treatment. Any doubt about a medicine, or new symptoms after taking it, belongs with your doctor or pharmacist, and in an emergency with the emergency services.",
      ],
    },
  ],
  faq: [
    {
      q: "Is the explanation a substitute for the patient leaflet?",
      a: "No. It is a short plain-language summary to help you understand. The full reference is the medicine's leaflet and your doctor's and pharmacist's instructions.",
    },
    {
      q: "Can I ask about a medicine that is not on my prescription?",
      a: "Yes, you can ask the assistant about any medicine in Arabic. The answer is general information, not a prescription or treatment advice for your case.",
    },
    {
      q: "Will it tell me the right dose for me?",
      a: "It explains the dose written on your prescription in simple words, and does not suggest a different one. Any change to a dose is for your doctor or pharmacist to decide.",
    },
  ],
  related: ["/features/prescription-reader", "/features/ai-assistant", "/for/patients", "/pricing"],
  updatedAt: "2026-10-20",
};
