import type { ProductPageContent } from "./types";

/** Audience page: doctors (English). */
export const doctorsEn: ProductPageContent = {
  meta: {
    title: "AI for Doctors: Read and Review Prescriptions",
    description:
      "Read older and colleagues' handwritten prescriptions, review a patient's medicines in one card and ask for drug information. Your judgment comes first.",
  },
  hero: {
    eyebrow: "For doctors",
    h1: "AI for doctors: readable prescriptions, reviewed medicines",
    lead: "An organized copy of the prescriptions that reach you, an assistant for drug information, and your clinical judgment as the final word.",
    cta: { label: "Create your free account", href: "/register" },
  },
  answer:
    "Wasfa AI helps a doctor read prescriptions, handwritten or printed, such as a colleague's or a pharmacy's, and review a patient's medicines and doses in an organized Arabic card that flags uncertain lines. It also offers an assistant for general drug information. It is an aid and does not replace clinical judgment.",
  sections: [
    {
      id: "reconcile",
      heading: "Reviewing what the patient is really taking",
      body: [
        "One of the harder moments in a visit is a patient who takes medicines from several doctors and cannot name them. If they have prescriptions, upload the photos and Wasfa AI reads them and gathers the medicines and doses into an Arabic table, flagging unclear handwriting instead of guessing.",
        "This is a quick first pass that saves time. It does not replace asking the patient and checking the medicines they actually hold.",
      ],
    },
    {
      id: "assistant",
      heading: "An assistant for general drug information",
      body: [
        "The medical assistant lets you ask in Arabic about a medicine, a possible interaction or a general fact, and you get a short answer with sources when it searches. It is a quick starting point, not a final clinical reference, so verify anything critical in your own trusted references.",
      ],
      bullets: [
        "Reads handwritten prescriptions from an image or a PDF.",
        "A card with drug, strength, dose, frequency, duration and confidence.",
        "An Arabic assistant with skills including drug information and drug interactions.",
        "A plain explanation you can hand to the patient on paper.",
      ],
    },
    {
      id: "judgment",
      heading: "Your clinical judgment comes first",
      body: [
        "Wasfa AI does not diagnose or issue prescriptions, and it does not replace a clinical examination or professional judgment. An automatic reading can be wrong, and everything it shows needs your review before you base a decision on it.",
        "If you run a clinic with a team, see the clinics page to learn how to create an organization and invite your colleagues.",
      ],
    },
    {
      id: "when",
      heading: "When is it most useful?",
      body: [
        "The tool helps most when prescriptions reach you from writers you do not know or hands you cannot read, when a patient carries loose papers from several places, or when you want to confirm a drug a patient names by its brand. It is also useful for giving the patient a written Arabic explanation to keep after they leave.",
        "It helps little when the photo is poor or the paper is damaged. In that case it will flag where it doubts and leave the decision to you.",
      ],
    },
    {
      id: "privacy",
      heading: "Your patient's privacy",
      body: [
        "A prescription is sensitive health information, so upload only what you need, with the patient's knowledge and in line with your professional rules. Files are kept in private storage that opens only through a temporary link, the privacy policy sets out what we collect and why, and you can delete your account at any time.",
      ],
    },
  ],
  faq: [
    {
      q: "Does Wasfa AI issue electronic prescriptions?",
      a: "No. It reads and explains existing prescriptions. It does not issue them or connect to e-prescribing systems.",
    },
    {
      q: "Can I rely on its reading without checking?",
      a: "No. It is an automatic reading that can be wrong. Review each line, especially flagged ones, before relying on it.",
    },
    {
      q: "Can I use it with patients in the clinic?",
      a: "Yes. You can show the patient the simplified result and print it for them, while you remain the one who explains and decides.",
    },
    {
      q: "Can several doctors in a clinic use it?",
      a: "Yes. Create an organization and invite colleagues as an admin or a member. The clinics page has the details.",
    },
  ],
  related: [
    "/features/handwritten-prescriptions",
    "/features/ai-assistant",
    "/for/clinics",
    "/pricing",
    "/contact",
  ],
  updatedAt: "2026-10-20",
};
