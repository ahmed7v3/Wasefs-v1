import type { ProductPageContent } from "./types";

/** Audience page: clinics and medical centres (English). */
export const clinicsEn: ProductPageContent = {
  meta: {
    title: "AI for Clinics: Review and Explain Prescriptions",
    description:
      "Create an organization for your clinic: read prescriptions patients bring, review their medicines and hand them a plain explanation. An aid for the doctor.",
  },
  hero: {
    eyebrow: "For clinics",
    h1: "AI for clinics: review prescriptions and explain them to patients",
    lead: "One organization for your clinic, a team with clear roles, and a tool that reads prescriptions and explains them in Arabic.",
    cta: { label: "Create your organization", href: "/register" },
  },
  answer:
    "Wasfa AI helps a clinic read prescriptions that patients bring from other doctors and pharmacies, review their medicines in a tidy Arabic card, and hand them a plain explanation. You create an organization for the clinic and invite staff as admins or members. It is a browser-based aid that does not write prescriptions or replace the doctor.",
  sections: [
    {
      id: "use-cases",
      heading: "How does a clinic benefit?",
      body: [
        'A patient arrives holding an old prescription, or one from another doctor, and says they take "a small white tablet for pressure". The doctor or nurse needs to know what they are really taking before deciding anything. Wasfa AI reads the photo of that prescription and lays out the medicines and doses in a table, so the conversation starts from written information.',
        "After the visit, the patient leaves with a plain Arabic explanation of their medicines, which they can print or send to themselves on WhatsApp, so fewer calls come in asking how to take a medicine.",
      ],
      bullets: [
        "Reads handwritten or printed prescriptions from an image or a PDF.",
        "An Arabic table of drug, strength, dose, frequency and duration.",
        "A review mark on every uncertain line.",
        "A simple patient explanation that can be printed or shared.",
      ],
    },
    {
      id: "organization",
      heading: "An organization for your clinic and team",
      body: [
        "You create an organization and invite your doctors, reception and nursing staff. Each member has a role: an admin who manages the organization, or a member who uses the tools. The organization has a shared balance, so each person does not need a separate plan.",
        "Plans and prices are on the pricing page. If your clinic needs a special arrangement, contact us and we will understand what you need.",
      ],
    },
    {
      id: "limits",
      heading: "What Wasfa AI does not do in a clinic",
      body: [
        "Wasfa AI is not a medical-records system. It does not write or issue prescriptions, and it does not connect to clinic management systems. It reads and explains what you put in front of it. An automatic reading can be wrong, so clinical verification and the treatment decision stay with the doctor.",
        "It is also not meant for emergencies and is no substitute for a medical consultation.",
      ],
    },
    {
      id: "workflow",
      heading: "What does a visit look like with Wasfa AI?",
      body: [
        "The tool does not ask you to change how you work. It slots into the usual visit in three short steps:",
      ],
      bullets: [
        "At reception or the start of the consultation, a team member photographs the prescriptions the patient brought.",
        "The organized card appears; the doctor reviews medicines and doses and pauses at flagged lines.",
        "At the end of the visit the patient receives a plain explanation of their medicines, printed or on WhatsApp.",
      ],
    },
    {
      id: "privacy",
      heading: "Patient data and privacy",
      body: [
        "A prescription is sensitive health information. Files are kept in private storage that opens only through a temporary link, and sensitive data is encrypted. We advise clinics to upload only what is needed, with the patient's knowledge and under their professional rules.",
        "The privacy policy explains what we collect, why, and how long we keep it.",
      ],
    },
  ],
  faq: [
    {
      q: "Does Wasfa AI write prescriptions for patients?",
      a: "No. It reads and explains existing prescriptions and does not issue them or replace the doctor's decision.",
    },
    {
      q: "Does the clinic need to install software?",
      a: "No. Wasfa AI runs in the browser on a phone or computer with nothing to install.",
    },
    {
      q: "How do I add my clinic team?",
      a: "Create an organization from your account and invite members as an admin or a member. To discuss an arrangement for your clinic, contact us.",
    },
    {
      q: "Is it suitable for large medical centers?",
      a: "It suits a team working through one organization with defined roles. If you run a center with many staff and need a special arrangement, contact us so we can understand what you need.",
    },
  ],
  related: [
    "/features/prescription-reader",
    "/features/medicine-explainer",
    "/for/doctors",
    "/pricing",
    "/contact",
  ],
  updatedAt: "2026-10-20",
};
