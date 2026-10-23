import type { landing } from "./landing";

/*
 * Landing page copy (English), mirroring `landing.ts` key for key. Same voice rules: the product
 * assists and never diagnoses; the analyzer is not live yet, so every call to action is "create a
 * free account" or "get early access"; no invented numbers, ratings, testimonials or certifications.
 */

export const landingEn: typeof landing = {
  hero: {
    pill: "Built for Arabic-speaking patients, pharmacists and doctors",
    titleLines: ["Understand your prescription in seconds.", "With precision that checks itself."],
    lead: "Wasfa AI is an Arabic-first assistant that reads a handwritten or printed prescription photo and turns it into a clear card with medicine names, doses, how often to take them, and warnings. Whatever we are not sure about, we put in front of you to review with your doctor or pharmacist.",
    primaryCta: "Create your free account",
    secondaryCta: "How does it work?",
    reassurance: "Creating an account is free and needs no bank card.",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
  },

  /** The illustration beside the hero headline: a sample, not a real result. */
  visual: {
    alt: "Illustrative example: a handwritten prescription is swept by a beam of light and turns into a structured result card with three lines, two confirmed and one unclear line flagged “Ask the pharmacist”. The card is labelled “Illustrative example”.",
    sampleBadge: "Illustrative example",
    paperTitle: "Prescription",
    resultTitle: "Structured result",
    resultMeta: "3 medicines",
    items: [
      { name: "Paracetamol 500 mg", detail: "One tablet every 8 hours · 3 days", flag: null },
      { name: "Amoxicillin 500 mg", detail: "One capsule every 12 hours · 7 days", flag: null },
      { name: "Unclear name", detail: "Check it with your pharmacist", flag: "review" },
    ],
    confidenceHigh: "High confidence",
    review: "Ask the pharmacist",
    note: "Wasfa AI assists and does not diagnose",
  },

  skills: {
    id: "features",
    eyebrow: "Wasfa skills",
    title: "A team of skills, each with its own face and its own job",
    lead: "Wasfa AI grows with specialised skills added over time. All of them help you understand, and none replaces your doctor or pharmacist.",
    items: [
      {
        mascot: "capsule",
        tone: "navy",
        title: "Prescription reading",
        body: "Turns a prescription photo, handwritten or printed, into an organised Arabic card.",
        soon: true,
      },
      {
        mascot: "hexagon",
        tone: "coral",
        title: "Drug interactions",
        body: "Points out medicines that may clash with each other so you can ask your pharmacist.",
        soon: true,
      },
      {
        mascot: "droplet",
        tone: "teal",
        title: "Doses and instructions",
        body: "The dose, how often, for how long, and how to take it, in one clear line.",
        soon: true,
      },
      {
        mascot: "tablet",
        tone: "amber",
        title: "Medicine explained to the patient",
        body: "Ask in Arabic about any medicine and get a simple explanation in plain words.",
        soon: true,
      },
      {
        mascot: "blob",
        tone: "olive",
        title: "Pharmacy assistant",
        body: "An organised workflow for pharmacists: reviewing prescriptions and preparing an explanation for each patient.",
        soon: true,
      },
      {
        mascot: "clover",
        tone: "indigo",
        title: "Scans and lab tests (educational)",
        body: "A simplified educational reading of lab and imaging reports. It does not replace your doctor.",
        soon: true,
      },
    ],
  },

  precision: {
    id: "precision",
    eyebrow: "Step by step",
    title: "What happens to each line of your prescription?",
    lead: "We follow one line from the handwriting to a result you can rely on. Whatever we are not sure about, we flag instead of guessing.",
    stepsLabel: "Four stages for every line",
    sampleBadge: "Illustrative example",
    steps: [
      {
        title: "We read the handwriting",
        body: "We read the handwritten line exactly as written, character by character, before any interpretation.",
      },
      {
        title: "We match it against the drug database",
        body: "We compare the name we read with the drug database and pick the closest one, with its active ingredient.",
      },
      {
        title: "We check the dose and frequency",
        body: "Shorthand such as “1×3” is normalised into a clear dose and number of times a day.",
      },
      {
        title: "We flag what we are not sure of",
        body: "An unclear line stays flagged with its raw text for the pharmacist to review. We do not guess its name.",
      },
    ],
    sample: {
      scribble: "Amoxil 500 1×3",
      readLabel: "Text we read",
      candidatesLabel: "Closest names in the drug database",
      candidates: ["Amoxil", "Amaryl", "Amoxapine"],
      ingredientLabel: "Active ingredient",
      ingredient: "Amoxicillin",
      rawLabel: "As written",
      raw: "1×3",
      normalized: "500 mg · 3 times a day",
      flaggedRaw: "Am?x…l  ?×2",
      flaggedBadge: "Ask the pharmacist",
      flaggedNote: "We show the raw text as we read it and do not guess the name.",
    },
    proof: {
      avgLabel: "Average analysis time",
      avgUnit: "seconds",
      accuracyLabel: "Field-reading accuracy in our evaluation tests",
      note: "Figures from internal tests; they change as the system improves.",
    },
    link: "Learn more about the prescription reader",
  },

  how: {
    id: "how-it-works",
    eyebrow: "How it works",
    title: "How does Wasfa AI work?",
    lead: "Three steps from a photo to a clear result in Arabic.",
    steps: [
      {
        title: "Upload the prescription",
        body: "Photograph the prescription with your phone camera, or upload an image or a PDF. Files are kept in private storage tied to your account.",
      },
      {
        title: "We analyse it for you",
        body: "AI reads the handwritten or printed text and extracts each medicine's name, dose, how often it is taken, and for how long.",
      },
      {
        title: "Review the structured result",
        body: "You get a tidy card in Arabic, with any uncertain line highlighted so you can check it with your doctor or pharmacist before relying on it.",
      },
    ],
  },

  audiences: {
    id: "audiences",
    eyebrow: "Who it is for",
    title: "For everyone who deals with a prescription",
    lead: "Patients who want to understand, pharmacists and doctors who want time, and organisations that want a system.",
    items: [
      {
        icon: "patient",
        tone: "teal",
        title: "For patients and families",
        body: "Understand your medicines and their doses in your own language before you leave the pharmacy.",
        points: [
          "A clear card with medicine names and doses",
          "Ask about any medicine and get a simple explanation",
        ],
        soon: true,
      },
      {
        icon: "pharmacist",
        tone: "navy",
        title: "For pharmacists",
        body: "Read difficult handwriting quickly, and start with what needs attention.",
        points: [
          "Low-confidence lines are highlighted so you review them first",
          "A ready explanation to share with the patient",
        ],
        soon: true,
      },
      {
        icon: "doctor",
        tone: "indigo",
        title: "For doctors",
        body: "An organised copy of prescriptions that makes reviewing medicines with the patient easier.",
        points: [
          "Medicines and doses in one tidy card",
          "It assists, and never replaces your clinical judgement",
        ],
        soon: true,
      },
      {
        icon: "organization",
        tone: "amber",
        title: "For pharmacies and clinics",
        body: "Create your organisation and invite your team with clear roles and permissions.",
        points: ["Roles and permissions for every team member", "Run all the work from one place"],
        soon: false,
      },
    ],
  },

  trust: {
    title: "Your privacy comes before any feature",
    lead: "We handle sensitive data, so we put privacy and clarity before any feature.",
    items: [
      {
        icon: "lock",
        title: "Private, encrypted storage",
        body: "Your files are kept in private storage that opens only through a temporary link meant for you, and sensitive data is protected with encryption.",
      },
      {
        icon: "shield",
        title: "You control your data",
        body: "We collect the minimum we need, the privacy policy explains what we collect and why, and you can delete your account at any time.",
      },
      {
        icon: "stethoscope",
        title: "It assists and does not diagnose",
        body: "Wasfa AI is an assistive tool. It does not diagnose and does not replace your doctor or pharmacist. Consult a professional before any treatment decision.",
      },
      {
        icon: "languages",
        title: "Arabic first",
        body: "A right-to-left Arabic interface and medical terms that are familiar to you in Egypt and the Gulf.",
      },
    ],
    privacyLink: "Read the privacy policy",
    disclaimerLink: "Read the medical disclaimer",
  },

  faq: {
    id: "faq",
    eyebrow: "Frequently asked questions",
    title: "We answer before you ask",
    lead: "Quick answers to what people ask us most.",
    moreTitle: "Did not find your answer?",
    moreLink: "Contact us",
    items: [
      {
        question: "What is Wasfa AI?",
        answer:
          "Wasfa AI is a smart medical assistant in Arabic. It reads a prescription photo and turns it into an organised card with medicine names, doses, how often to take them and warnings, and it answers your questions about medicines in simple language.",
      },
      {
        question: "Does it diagnose conditions or replace the doctor?",
        answer:
          "No. Wasfa AI is an assistive tool that explains and organises information. It gives no diagnosis and no treatment prescription. Consult your doctor or pharmacist before any decision about your treatment.",
      },
      {
        question: "Which kinds of prescriptions can be analysed?",
        answer:
          "Handwritten and printed prescriptions, as a photo or a PDF file. Image quality affects accuracy, and when we are not sure about a line we flag it for you to check instead of guessing.",
      },
      {
        question: "Are my data and photos safe?",
        answer:
          "We keep files in private storage that is available only through a temporary link, we encrypt sensitive data, and we collect the minimum we need. The full details are in the privacy policy.",
      },
      {
        question: "Is the service free?",
        answer:
          "Creating an account is free. A free monthly allowance of analyses will be available when the analyzer launches, paid plans are announced before they are switched on, and we will never charge you without your consent.",
      },
      {
        question: "When does prescription analysis start?",
        answer:
          "The feature is being prepared and will become available gradually in the coming period. If you create your account now, it will be ready as soon as the feature is available.",
      },
      {
        question: "Is it suitable for pharmacies and clinics?",
        answer:
          "Yes. You can create an organisation and invite your team with different roles and permissions, and we will add team tools as the product grows.",
      },
      {
        question: "How do I delete my account and data?",
        answer:
          "You can request deletion from your account page at any time. We keep the data for 14 days so you can change your mind, then we permanently anonymise your identity. The details are in the privacy policy.",
      },
    ],
  },

  cta: {
    title: "Start understanding your prescription with confidence",
    body: "Create your free account now and be among the first to try Wasfa AI as soon as it is available.",
    primary: "Get early access",
    secondary: "Contact us",
  },

  footer: {
    tagline:
      "An Arabic medical assistant that reads prescriptions fast and checks itself carefully.",
    product: "Product",
  },

  notices: {
    accountDeleted:
      "We received your account deletion request. You can restore it within 14 days by contacting support, after which your personal data is permanently deleted.",
  },
};
