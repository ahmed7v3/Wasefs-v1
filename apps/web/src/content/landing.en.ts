import type { landing } from "./landing";

/*
 * Landing page copy (English), mirroring `landing.ts` key for key. Same voice rules: the product
 * assists and never diagnoses; the web app is live, so calls to action say "create a free account",
 * and only the Android and iOS apps are still "coming soon"; no invented numbers, ratings,
 * testimonials or certifications.
 */

export const landingEn: typeof landing = {
  hero: {
    pill: "A smart Arabic-first assistant, on the web and on WhatsApp",
    titleLines: ["Your prescription, clear in seconds…", "even from WhatsApp"],
    lead: "Snap any prescription, even a handwritten one, and know every medicine, its dose and its schedule. Then chat with a smart assistant on the website or on WhatsApp. Wasfa helps you understand and does not replace your doctor or pharmacist.",
    primaryCta: "Start free",
    whatsappCta: "Chat with Wasfa on WhatsApp",
    whatsappGreeting: "Hello Wasfa",
    chips: ["No app to install", "100% Arabic", "Your privacy protected"],
    haveAccount: "Already have an account?",
    signIn: "Sign in",
  },

  /** The hero illustration: a WhatsApp-style chat with the assistant. A sample, not a real result. */
  scene: {
    alt: "Illustration (example): a phone showing a WhatsApp chat in which the user sent a prescription photo and the assistant replied with a card of two medicines, each with its dose and schedule, then a PDF file and a voice note. A handwritten prescription sheet sits beside it.",
    sampleBadge: "Illustrative example",
    agentName: "Wasfa",
    agentStatus: "Smart assistant",
    photoCaption: "Prescription photo",
    reply: "I read your prescription. Here are your medicines and their schedule:",
    items: [
      {
        name: "Amoxicillin 500 mg",
        dose: "One capsule after food · 7 days",
        times: [
          { label: "8 am", kind: "sun" },
          { label: "2 pm", kind: "sun" },
          { label: "8 pm", kind: "moon" },
        ],
      },
      {
        name: "Paracetamol 500 mg",
        dose: "One tablet if needed · 3 days",
        times: [
          { label: "8 am", kind: "sun" },
          { label: "8 pm", kind: "moon" },
        ],
      },
    ],
    pdfName: "Prescription report.pdf",
    pdfMeta: "PDF · ready to share",
    voiceLabel: "Voice note",
    voiceLength: "0:12",
  },

  whatsapp: {
    id: "whatsapp",
    eyebrow: "WhatsApp",
    title: "Everything from WhatsApp… with a very smart assistant",
    lead: "No app to install and no menus to get lost in. Send a message, and Wasfa understands you and replies.",
    tilesLabel: "What you can do on WhatsApp",
    tiles: [
      {
        icon: "photo",
        title: "Send a prescription photo",
        body: "It reads the whole thing and sends back the medicines, doses and schedule in one message.",
      },
      {
        icon: "voice",
        title: "Talk with your voice",
        body: "Send a voice note and it listens, then replies with a voice note too.",
      },
      {
        icon: "medicine",
        title: "Ask about any medicine",
        body: "Prices and cheaper alternatives with the same active ingredient, from a database of more than 27,000 Egyptian medicines.",
      },
      {
        icon: "files",
        title: "Get your files",
        body: "A PDF report and a medication schedule card to keep and share.",
      },
      {
        icon: "pay",
        title: "Subscribe and pay in the chat",
        body: "Pick a plan and complete payment from the same conversation.",
      },
      {
        icon: "account",
        title: "Create your account in one message",
        body: "Start the chat and the assistant sets up your account in a single step.",
      },
    ],
    phoneLabel:
      "Example WhatsApp chat: a prescription photo is sent, the assistant reads it and replies with the medicine card and schedule, then a voice note, a question about a cheaper alternative, and a PDF file.",
    chat: [
      { from: "user", kind: "photo", text: "Prescription photo" },
      { from: "agent", kind: "text", text: "Got the prescription, reading it now." },
      { from: "agent", kind: "meds", text: "Done. Here are your medicines and their schedule:" },
      { from: "user", kind: "voice", text: "0:07" },
      { from: "agent", kind: "voice", text: "0:09" },
      { from: "user", kind: "text", text: "Is there a cheaper alternative to the first one?" },
      {
        from: "agent",
        kind: "text",
        text: "Yes, alternatives with the same active ingredient. I will list them with prices for you to check with your pharmacist.",
      },
      { from: "agent", kind: "file", text: "Prescription report.pdf" },
    ],
    cta: "Start the chat on WhatsApp",
    qrTitle: "Or scan the code with your phone",
    qrLabel: "QR code that opens the chat with Wasfa on WhatsApp",
    note: "Wasfa explains and organises and does not diagnose. Check with your doctor or pharmacist before any treatment decision.",
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
        soon: false,
      },
      {
        mascot: "hexagon",
        tone: "coral",
        title: "Drug interactions",
        body: "Points out medicines that may clash with each other so you can ask your pharmacist.",
        soon: false,
      },
      {
        mascot: "droplet",
        tone: "teal",
        title: "Doses and instructions",
        body: "The dose, how often, for how long, and how to take it, in one clear line.",
        soon: false,
      },
      {
        mascot: "tablet",
        tone: "amber",
        title: "Medicine explained to the patient",
        body: "Ask in Arabic about any medicine and get a simple explanation in plain words.",
        soon: false,
      },
      {
        mascot: "blob",
        tone: "olive",
        title: "Pharmacy assistant",
        body: "Start with the lines that need review, then copy, share or print the explanation for the patient.",
        soon: false,
      },
      {
        mascot: "clover",
        tone: "indigo",
        title: "Scans and lab tests (educational)",
        body: "A simplified educational reading of lab and imaging reports. It does not replace your doctor.",
        soon: false,
      },
    ],
  },

  precision: {
    id: "precision",
    eyebrow: "Step by step",
    title: "The journey of every line in your prescription",
    lead: "We follow a single line from the handwriting to a result you can trust. Whatever we are not sure about, we flag instead of guessing.",
    stepsLabel: "Four stages for every line",
    sampleBadge: "Illustrative example",
    steps: [
      {
        title: "Reading the handwriting",
        body: "We read the handwritten line as it is, letter by letter, before any interpretation.",
      },
      {
        title: "Precise matching",
        body: "We compare the name we read with the medicine database and pick the closest one with its active ingredient.",
      },
      {
        title: "Safety check",
        body: "We check the dose and strength, and warn when the same active ingredient appears in two medicines.",
      },
      {
        title: "A clear result",
        body: "A tidy card with the medicine and its schedule. Any line we are unsure about stays flagged for you to review.",
      },
    ],
    sample: {
      scribble: "Amoxil 500 1×3",
      readLabel: "What we read",
      candidatesLabel: "Closest names in the medicine database",
      candidates: ["Amoxil", "Amaryl", "Amoxapine"],
      confidence: "High confidence",
      ingredientLabel: "Active ingredient",
      ingredient: "Amoxicillin",
      doseLabel: "Dose",
      dose: "500 mg · 3 times a day",
      doseOk: "Within the usual range",
      duplicateBadge: "Duplicate active ingredient",
      duplicateNote: "Paracetamol appears in two medicines on this prescription.",
      resultName: "Amoxicillin 500 mg",
      resultDetail: "3 times a day · 7 days",
      resultTimes: [
        { label: "8 am", kind: "sun" },
        { label: "2 pm", kind: "sun" },
        { label: "8 pm", kind: "moon" },
      ],
    },
    proof: {
      avgLabel: "Average analysis time",
      avgUnit: "seconds",
      accuracyLabel: "Field reading accuracy in evaluation tests",
      note: "Figures from internal tests; they change as the system improves.",
    },
    link: "Learn more about the prescription reader",
  },

  how: {
    id: "how-it-works",
    eyebrow: "How it works",
    title: "How does Wasfa AI work?",
    lead: "Three steps from a photo to a clear result in Arabic.",
    whatsappNote: "Or just send it on WhatsApp and the assistant will reply.",
    whatsappLink: "Open the chat",
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
        soon: false,
      },
      {
        icon: "pharmacist",
        tone: "navy",
        title: "For pharmacists",
        body: "Read difficult handwriting quickly, and start with what needs attention.",
        points: [
          "Low-confidence lines are highlighted so you review them first",
          "An explanation you can copy, share or print for the patient",
        ],
        soon: false,
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
        soon: false,
      },
      {
        icon: "organization",
        tone: "amber",
        title: "For pharmacies and clinics",
        body: "Create your organisation, invite your team with clear roles and permissions, and follow usage from one dashboard.",
        points: [
          "Roles and permissions for every team member",
          "One dashboard for members and usage",
        ],
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
    exclusive: true,
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
          "Creating an account is free and includes a free monthly allowance of prescription analyses. If you need more, the paid plans and their prices are on the pricing page, and we will never charge you without your consent.",
      },
      {
        question: "How do I start analysing my prescription?",
        answer:
          "Create your free account, then upload a photo of the prescription or a PDF from the analysis page, and the structured result appears within moments for you to review.",
      },
      {
        question: "Is it suitable for pharmacies and clinics?",
        answer:
          "Yes. You can create an organisation and invite your team with different roles and permissions, and follow members and usage from the organisation dashboard.",
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
    body: "Create your free account now, or send your first prescription on WhatsApp and ask about any medicine in Arabic.",
    primary: "Start free",
    whatsapp: "Chat with Wasfa on WhatsApp",
    secondary: "Contact us",
  },

  /** "Wasfa in your pocket": the ways to use the product today and what is still coming. */
  apps: {
    title: "Wasfa in your pocket",
    lead: "Wasfa works today on any phone, from the browser or from WhatsApp. The Android and iOS apps are coming soon.",
    phoneLabel:
      "Illustration of a phone screen showing a prescription analysis result with two medicine cards and their schedules (illustrative example)",
    resultTitle: "Structured result",
    resultMeta: "2 medicines",
    resultNote: "Wasfa assists and does not diagnose",
    sampleBadge: "Illustrative example",
    waysLabel: "Ways to use Wasfa",
    ways: [
      {
        key: "whatsapp",
        title: "WhatsApp",
        body: "Send the prescription and ask the assistant, with nothing to install.",
        status: "Available now",
      },
      {
        key: "web",
        title: "Web app",
        body: "Open the site in your browser and add it to your phone's home screen.",
        status: "Available now",
      },
      {
        key: "native",
        title: "Phone apps",
        body: "We are building dedicated apps for Android and iOS.",
        status: "Coming soon",
      },
    ],
    soon: "Coming soon",
    android: "Android",
    ios: "iOS",
    googlePlay: "Google Play",
    appStore: "App Store",
    waitlist: {
      title: "Notify me at launch",
      lead: "Leave your email and we will write to you once, when the app is available.",
      email: "Email",
      platform: "Platform",
      platforms: { android: "Android", ios: "iOS", both: "Android and iOS" },
      consent: "I agree that Wasfa AI emails me when the app launches.",
      consentRequired: "To continue, agree to receive the launch email.",
      submit: "Notify me at launch",
      successTitle: "You are on the list",
      successBody: "We will email you when the app launches. You can unsubscribe from that email.",
      disabled: "Joining the waiting list is not available right now.",
    },
  },

  footer: {
    tagline:
      "An Arabic medical assistant that reads prescriptions fast and checks itself carefully.",
    appsSoon: "Apps coming soon",
    columnsLabel: "Site links",
    product: "Product",
    company: "Company",
    legal: "Legal",
    links: {
      prescriptionReader: "Prescription reader",
      handwrittenPrescriptions: "Handwritten prescriptions",
      medicineExplainer: "Medicine explainer",
      aiAssistant: "AI assistant",
      pricing: "Pricing",
      pharmacists: "For pharmacists",
      clinics: "For clinics",
      about: "About Wasfa AI",
      editorialPolicy: "Editorial policy",
      medicalReview: "Medical review",
      sources: "Sources",
      contact: "Contact us",
      privacy: "Privacy policy",
      terms: "Terms of use",
      disclaimer: "Medical disclaimer",
    },
  },

  notices: {
    accountDeleted:
      "We received your account deletion request. You can restore it within 14 days by contacting support, after which your personal data is permanently deleted.",
  },
};
