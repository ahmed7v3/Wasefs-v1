import type { ProductPageContent } from "./types";

/** Feature page: handwritten prescriptions / reading doctors' handwriting (English). */
export const handwrittenPrescriptionsEn: ProductPageContent = {
  meta: {
    title: "Read Doctor Handwriting on Prescriptions with AI",
    description:
      "Can't read your doctor's handwriting? Photograph the prescription for a clear reading of medicines and doses. Unclear lines are flagged for the pharmacist.",
  },
  hero: {
    eyebrow: "Reading doctors' handwriting",
    h1: "Read doctor handwriting: decode a handwritten prescription",
    lead: "When neither you nor the pharmacist can make out a line, Wasfa AI reads it with you and tells you plainly when it is not sure.",
    cta: { label: "Try it with a free account", href: "/register" },
  },
  answer:
    "Wasfa AI reads a handwritten prescription from its photo and turns what the doctor wrote into a table of medicines, doses and frequencies. It reads the text twice, matches names against a drug database, and flags any line that stays unclear so you ask your pharmacist about it instead of guessing.",
  sections: [
    {
      id: "why-hard",
      heading: "Why is doctors' handwriting so hard to read?",
      body: [
        "A doctor in a busy clinic writes fast. Letters run together, words are shortened, and Latin drug names are scribbled at a slant. Pharmacists sometimes have to phone the prescriber, and patients are left holding a page they cannot make sense of.",
        "That is more than an inconvenience, because a wrong drug name or strength can have real consequences. So we build handwriting reading on verification, not on guessing.",
      ],
    },
    {
      id: "how",
      heading: "How does Wasfa AI decode the handwriting?",
      body: [
        "You upload a photo, we enhance the image and locate where the writing is. The AI then reads the text twice, independently, and any difference between the two readings is marked instead of ignored.",
        "Next, each name is matched against the medicines database. If the handwriting suggests two similar names, we prefer the one that really exists in the database with a known strength, and if neither convinces us, we flag the line. Every line then gets a confidence score.",
      ],
      bullets: [
        "Two independent readings of the text instead of one.",
        "Name and strength checked against a medicines database.",
        "A confidence score per line; low ones are sent to you for review.",
      ],
    },
    {
      id: "uncertain",
      heading: "What happens when a line cannot be read?",
      body: [
        "This is the difference between a tool that helps and one that gambles. If a line is still unclear after every stage, it appears in the result with a review mark, rather than being filled in with the likeliest guess and shown as if it were certain.",
        'If the prescriber\'s name or signature is illegible we say so, and if parts of the page could not be read we tell you how many. We would rather say "check this line" than be confidently wrong.',
      ],
    },
    {
      id: "tips",
      heading: "Tips for photographing a handwritten prescription",
      body: [
        "Image quality matters a lot for handwriting. A few simple habits improve the chance of a clear reading:",
      ],
      bullets: [
        "Lay the page flat in good light and keep your hand's or phone's shadow off it.",
        "Keep the whole sheet in the frame, away from cropped edges.",
        "Hold the phone steady, and retake the photo if the letters look blurred.",
        "If the prescription has two sheets, photograph each one separately.",
      ],
    },
    {
      id: "limits",
      heading: "What the tool cannot do",
      body: [
        "No tool can promise to read every hand. Some writing defeats even an experienced pharmacist, and then the right answer is to call the doctor or the clinic. Wasfa AI helps you read most of a prescription quickly and see exactly where the doubt is, but it does not replace your pharmacist or doctor, and nothing should be dispensed or taken on its reading alone.",
      ],
    },
  ],
  faq: [
    {
      q: "Can Wasfa AI read any doctor's handwriting?",
      a: "No tool can. It reads many handwritten prescriptions, and flags what it is unsure about. If a line stays unclear, ask your pharmacist or doctor.",
    },
    {
      q: "Does it read English handwriting on prescriptions?",
      a: "Yes. It reads text in Arabic or Latin letters, and drug names on prescriptions are usually written in English. The result is shown in Arabic.",
    },
    {
      q: "Can I rely on the result to dispense or take a medicine?",
      a: "No. The result is an automatic reading that may contain errors. Confirm every medicine and dose with your pharmacist or doctor first.",
    },
  ],
  related: [
    "/features/prescription-reader",
    "/features/medicine-explainer",
    "/for/pharmacists",
    "/for/patients",
    "/pricing",
  ],
  updatedAt: "2026-10-20",
};
