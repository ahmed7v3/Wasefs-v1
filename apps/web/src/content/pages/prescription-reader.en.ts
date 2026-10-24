import type { ProductPageContent } from "./types";

/** Feature page: AI prescription reader (English). */
export const prescriptionReaderEn: ProductPageContent = {
  meta: {
    title: "AI Prescription Reader: Scan and Understand",
    description:
      "Upload a photo of a handwritten or printed prescription and get a clear card of medicines, doses and warnings. Unclear lines are flagged for review.",
  },
  hero: {
    eyebrow: "AI prescription reader",
    h1: "AI prescription reader: scan it, then understand it",
    lead: "Wasfa AI turns a photo of a prescription into an organized, Arabic-language card, then checks it before showing it to you.",
    cta: { label: "Create your free account", href: "/register" },
  },
  answer:
    "Wasfa AI reads a photo of a handwritten or printed prescription and extracts each medicine with its strength, dose, frequency and duration. It then matches the names against a drug database and flags every uncertain line for your pharmacist to confirm. It is an aid, not a replacement for a pharmacist or doctor.",
  sections: [
    {
      id: "how",
      heading: "How does Wasfa AI read a prescription?",
      body: [
        "You start by photographing the prescription with your phone camera, or by uploading an image or a PDF. Files are kept in private storage tied to your account and are opened only through a temporary link.",
        "Each prescription then goes through four stages: the image is cleaned up and the text regions are located; the text is read twice, independently, and any disagreement between the two readings is marked rather than ignored; every drug name is matched against a medicines database to check the name and strength; and finally each line gets a confidence score.",
      ],
      bullets: [
        "Photograph the page in good light, without shadows, with the whole sheet in frame.",
        "Upload several images if the prescription runs over more than one page.",
        "Wait for the result and follow the progress on screen.",
      ],
    },
    {
      id: "result",
      heading: "What does the result card show?",
      body: [
        "The result is a tidy table. For each medicine you see its name, strength, form, dose, frequency, duration and route, together with the confidence we have in that line.",
        "If the prescriber's name or signature is illegible, or parts of the sheet could not be read, the card says so openly instead of guessing. When something needs attention, a general notice asks you to check with your pharmacist.",
        "You can print the result or share it on WhatsApp as a short message that states the reading is automatic and should be confirmed by a pharmacist. Every earlier analysis stays in your history.",
      ],
    },
    {
      id: "identify",
      heading: "Finding out which medicine is written on a prescription",
      body: [
        "Many people just want to know what a hard-to-read line says. Wasfa AI reads the drug name from the prescription text itself, whether it is written in Arabic or Latin letters, and compares it with the medicines database to suggest the closest match.",
        "This works on the text of a prescription only. It does not identify a loose pill from a photo or a box without a prescription, so please do not upload a picture of a tablet and expect an answer.",
      ],
    },
    {
      id: "accuracy",
      heading: "Can AI read prescriptions accurately?",
      body: [
        "The honest answer is that accuracy varies. Modern models read most printed prescriptions and many handwritten ones, but a blurry photo, overlapping writing or a rare drug name can make any reading, human or machine, uncertain.",
        "That is why this page quotes no single accuracy percentage: a figure without a measurement method misleads more than it helps. What we can explain is how we guard against mistakes: two independent readings that are compared, a match against the medicines database, a confidence score per line, and a flag on every line below the accepted level instead of presenting it as certain.",
        "Internally we measure reading quality on test sets of prescriptions whose correct answers are known, and we review the errors to improve the system. You can also rate each result and, optionally, agree to let our team review the image so accuracy improves.",
        "In every case, confirm each medicine and dose with your pharmacist or doctor before use. An automatic reading helps you understand; it is not the final word for dispensing or treatment.",
      ],
    },
    {
      id: "chatbot",
      heading: "Why a dedicated tool instead of a general chatbot?",
      body: [
        "Some general chatbots can describe an uploaded image, but they do not check what they read against a drug database, they do not score their confidence line by line, and they may present a guess with full confidence. On a prescription, that is exactly the risk.",
        "Wasfa AI is built for one job: reading Arabic-market prescriptions, verifying them and showing its doubts plainly. Once the result is on screen, you can ask the medical assistant about any medicine in it.",
      ],
    },
    {
      id: "availability",
      heading: "Where does it work and what does it cost?",
      body: [
        "Wasfa AI works today as a web app in your phone or desktop browser, with nothing to install. The interface is in Arabic. Creating an account is free, and each plan's allowance and price are on the pricing page.",
      ],
    },
  ],
  faq: [
    {
      q: "Which prescriptions can Wasfa AI read?",
      a: "Handwritten and printed prescriptions, as an image or a PDF. Photo quality affects the result, and when we are not sure about a line we flag it for you to check instead of guessing.",
    },
    {
      q: "Can the reading be wrong?",
      a: "Yes, any automatic reading can be wrong. That is why every line shows a confidence level, uncertain ones are flagged, and we ask you to confirm with your pharmacist or doctor before using any medicine.",
    },
    {
      q: "Does it read prescriptions written in English?",
      a: "It reads text in Arabic or Latin letters, and drug names on prescriptions in Egypt and the Gulf are often written in English. The interface and the results are in Arabic.",
    },
    {
      q: "Are the prescription photos I upload stored safely?",
      a: "They are kept in private storage opened only through a temporary link, and sensitive data is encrypted. Details are in the privacy policy, and you can delete your account at any time.",
    },
  ],
  related: [
    "/features/handwritten-prescriptions",
    "/features/medicine-explainer",
    "/for/patients",
    "/for/pharmacists",
    "/pricing",
  ],
  updatedAt: "2026-10-20",
};
