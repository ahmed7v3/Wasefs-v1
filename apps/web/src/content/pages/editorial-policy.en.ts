// DRAFT — needs owner approval (phase4 WP2 step 8).
import type { ProductPageContent } from "./types";

/** Trust page: editorial policy (English). */
export const editorialPolicyEn: ProductPageContent = {
  meta: {
    title: "Editorial Policy",
    description:
      "How Wasfa AI writes medical content: AI in drafting, standards for sources and review, corrections, conflicts of interest and advertising kept separate.",
  },
  hero: {
    eyebrow: "Editorial policy",
    h1: "Editorial policy: how we write what you read about medicines",
    lead: "Drug information shapes decisions, so we set out our standards plainly for you to hold us to.",
    cta: { label: "Report an error", href: "/contact" },
  },
  answer:
    "We write medical content to clear standards: primary sources first, review by a qualified professional before any medical page is published, open disclosure of any AI assistance in drafting, and public corrections. No advertiser or sponsor influences what we write, and anything written with AI help gets the same human review as any other text.",
  sections: [
    {
      id: "scope",
      heading: "What this policy covers",
      body: [
        "This policy applies to everything we publish on Wasfa AI, from product pages to any article, guide or medicine page we add later. Product pages describe what the app does and give no treatment advice; medical content is held to the stricter standards below.",
      ],
    },
    {
      id: "ai",
      heading: "AI in drafting",
      body: [
        "We may use AI tools to draft and organize text, and we will say so on the page concerned. Text drafted with AI help is not published because a machine wrote it; it goes through the same review as any other text, and we do not publish medical content that no human has reviewed.",
        "The AI inside the product itself, meaning the prescription reader and the medical assistant, is separate from this policy, and its limits are set out in the medical disclaimer.",
      ],
    },
    {
      id: "sources",
      heading: "Sources and review",
      body: [
        "We build medical information on reliable primary sources, as the sources page explains, and we attribute important facts to them. Before a medical page is published it is reviewed by a qualified professional, as the medical review page describes, and the page will carry the reviewer's name and the review date once reviewers are appointed.",
      ],
    },
    {
      id: "corrections",
      heading: "Corrections",
      body: [
        "If you find a mistake, tell us through the contact page. We look into every report; if it holds up we correct the page and update its last-modified date, and for substantive corrections we say what changed rather than hide it.",
      ],
    },
    {
      id: "conflicts",
      heading: "Conflicts of interest and advertising",
      body: [
        "No advertiser or drug company pays for what we write, and we do not recommend a medicine in return for payment. If we ever show advertising, it will be labelled and kept apart from content, it will not appear on medical pages, and it will not shape what we write. If an author or reviewer has an interest in a page's subject, it will be disclosed.",
      ],
    },
    {
      id: "safe",
      heading: "Is it safe to use AI for medicine information?",
      body: [
        "AI is a useful aid for understanding, but it can be wrong, so we never present it as a substitute for your doctor or pharmacist. We flag what we are unsure of, we show sources when the assistant searches, and we ask you to confirm every medicine and dose before use.",
      ],
    },
  ],
  faq: [],
  related: ["/medical-review", "/sources", "/about", "/disclaimer"],
  updatedAt: "2026-10-20",
};
