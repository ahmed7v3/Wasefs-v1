// DRAFT — needs owner approval (phase4 WP2 step 8).
import type { ProductPageContent } from "./types";

/** Trust page: medical review process (English). No reviewer is named: none is appointed yet (O5). */
export const medicalReviewEn: ProductPageContent = {
  meta: {
    title: "Medical Review of Our Content",
    description:
      "How Wasfa AI will review medical content before publishing and how to report an error. Reviewer names and dates will be shown once reviewers are appointed.",
  },
  hero: {
    eyebrow: "Medical review",
    h1: "Medical review: how professionals check what we publish",
    lead: "Here is the process that will apply to medical content, and a plain statement of what exists today and what has not started yet.",
    cta: { label: "Report an error", href: "/contact" },
  },
  answer:
    "No medical content is published on Wasfa AI without review of that exact version by a qualified professional, such as a doctor or pharmacist. We have not appointed reviewers yet, so no page carries a medical review mark today. Once they are appointed, every medical page will show the reviewer's name and the review date.",
  sections: [
    {
      id: "status",
      heading: "Where things stand today",
      body: [
        "We want to be upfront: we have not yet appointed medical reviewers. Product pages, such as the prescription reader page and the audience pages, describe what the app does and give no medical treatment content, so they carry no medical review mark.",
        "When we begin to publish medical content, such as articles, guides and medicine pages, it will be published only after the process below is complete.",
      ],
    },
    {
      id: "process",
      heading: "How review will work",
      body: ["Every medical page will go through these steps before readers see it:"],
      bullets: [
        "The draft is written from reliable primary sources as described on the sources page, and any AI assistance in drafting is disclosed.",
        "A qualified medical or pharmacy professional reviews the exact version due to be published, and it is not published before they approve it.",
        "If the page changes after review, the new version is reviewed again.",
        "The reviewer's name, role and review date appear on the page and in its structured data.",
        "Pages are re-reviewed periodically, and the review mark is updated after any substantive change.",
      ],
    },
    {
      id: "criteria",
      heading: "What does the reviewer check?",
      body: [
        "The reviewer checks that the information is correct and current, that the wording does not exaggerate or promise treatment results, that sources are cited and accurate, that the text directs the reader to a doctor or pharmacist where needed, and that it avoids language that causes needless fear.",
      ],
    },
    {
      id: "report",
      heading: "How to report an error",
      body: [
        "If you see information you think is wrong or out of date, tell us through the contact page with a link to the page. We look into the report, correct the page if it holds up, and explain the correction as the editorial policy requires.",
      ],
    },
  ],
  faq: [],
  related: ["/editorial-policy", "/sources", "/about", "/disclaimer"],
  updatedAt: "2026-10-20",
};
