import type { ProductPageContent } from "./types";

/** Audience page: pharmacists (English). */
export const pharmacistsEn: ProductPageContent = {
  meta: {
    title: "AI for Pharmacists: Read Prescriptions Faster",
    description:
      "An AI assistant that reads hard prescriptions, puts low-confidence lines first for your review and gives patients a clear explanation. You stay in charge.",
  },
  hero: {
    eyebrow: "For pharmacists",
    h1: "AI for pharmacists: read prescriptions faster, review what matters",
    lead: "Wasfa AI shortens the time you spend deciphering difficult handwriting and points you to the uncertain lines first.",
    cta: { label: "Create your free account", href: "/register" },
  },
  answer:
    "Wasfa AI is an assistant for pharmacists that reads a prescription from its photo, handwritten or printed, and turns it into a table of medicines and doses, marking low-confidence lines for you to review first. You can create an organization for your team and print or share an explanation with the patient. The professional decision always stays with the pharmacist.",
  sections: [
    {
      id: "why",
      heading: "Where does the assistant save you time?",
      body: [
        "In a busy pharmacy, precious minutes go into decoding a single line of a prescription. Wasfa AI reads the photo and lays out medicines, strengths and doses in a tidy Arabic table, so your review starts from written text rather than from scratch.",
        "It is not dispensing software and does not replace your pharmacy system. It works alongside it as a reading and explanation tool in the browser, and it does not connect to pharmacy management systems.",
      ],
    },
    {
      id: "review-first",
      heading: "Start with what needs your review",
      body: [
        "Each prescription goes through two independent readings, a match against a medicines database and a confidence check per line. Lines whose confidence falls below the threshold carry a review mark, so you see at a glance where to concentrate.",
        "That is useful for a pharmacist in particular: you do not need to doubt every line equally, because the tool sorts out what deserves a closer look. It does not excuse you from verifying, though. An automatic reading can be wrong, and professional responsibility for dispensing stays with the pharmacist.",
      ],
      bullets: [
        "A table of drug, strength, form, dose, frequency and duration.",
        "A confidence score per line and a clear mark on uncertain ones.",
        "A general notice asking for pharmacist review when needed.",
      ],
    },
    {
      id: "patient",
      heading: "A ready explanation to share with the patient",
      body: [
        "Patients want to understand what they are taking, and you know how little time there is. The result shows a plain explanation for each medicine, and you can print it or send it on WhatsApp as a short message stating that the reading is automatic and the pharmacist is the reference. The patient leaves with a page they understand, and you keep the last word.",
      ],
    },
    {
      id: "team",
      heading: "For pharmacies with more than one pharmacist",
      body: [
        "You can create an organization for your pharmacy and invite your team as an admin or a member, manage the work in one place, and share the organization's balance. Plans and prices are on the pricing page, or contact us if you want an arrangement that fits the size of your team.",
      ],
    },
  ],
  faq: [
    {
      q: "Does Wasfa AI replace the pharmacist's review of a prescription?",
      a: "No. It is an aid that speeds up reading and highlights doubt. Professional verification of the medicine and dose before dispensing is the pharmacist's responsibility.",
    },
    {
      q: "Does it connect to the pharmacy software I use?",
      a: "No. Wasfa AI is a standalone web app that runs in the browser and does not connect to pharmacy management systems.",
    },
    {
      q: "Can my team use it together?",
      a: "Yes. Create an organization and invite your team as an admin or a member. For an arrangement that suits your pharmacy, contact us.",
    },
  ],
  related: [
    "/features/handwritten-prescriptions",
    "/features/prescription-reader",
    "/for/clinics",
    "/pricing",
    "/contact",
  ],
  updatedAt: "2026-10-20",
};
