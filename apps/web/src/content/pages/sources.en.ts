// DRAFT — needs owner approval (phase4 WP2 step 8).
import type { ProductPageContent } from "./types";

/** Trust page: source policy (English). States a policy, never a licensed dataset (O7). */
export const sourcesEn: ProductPageContent = {
  meta: {
    title: "Sources of Our Drug Information",
    description:
      "Where drug information on Wasfa AI comes from: primary sources such as official drug authorities and leaflets, named and dated. No licensed dataset.",
  },
  hero: {
    eyebrow: "Sources",
    h1: "Sources of drug information: where what we say comes from",
    lead: "The source policy we follow whenever we write a fact about a medicine.",
    cta: { label: "Suggest a source or fix a fact", href: "/contact" },
  },
  answer:
    "For drug information we prefer primary sources: official drug authority data and approved medicine leaflets, and we name the source and the date we consulted it. We use only what may be used, on the terms each source allows. We do not claim a licence to any particular database, or an endorsement from any official body.",
  sections: [
    {
      id: "primary",
      heading: "Primary sources first",
      body: [
        "Our order is clear: primary before secondary. By primary we mean the body that issued or approved the information, such as the Egyptian Drug Authority (EDA), the Saudi Food and Drug Authority (SFDA), the European Medicines Agency (EMA), and medicine leaflets published through DailyMed.",
        "We turn to secondary sources, such as reference works and peer-reviewed journals, when a primary source is missing or when we need a deeper explanation, and we say so.",
      ],
      bullets: [
        "Egyptian Drug Authority (EDA).",
        "Saudi Food and Drug Authority (SFDA).",
        "European Medicines Agency (EMA).",
        "Medicine leaflets on DailyMed.",
      ],
    },
    {
      id: "permitted",
      heading: "We use only what is permitted",
      body: [
        "Each source has different terms of use. What is available for use we use on the source's terms, and what is not we do not copy. So we write facts in our own words and attribute them to their source rather than reproduce them verbatim, unless reproduction is allowed.",
        "We repeat what the about page says: we do not claim a licence to any commercial database, nor any affiliation with or endorsement from an official body. Naming an authority here means it is a source we consult, not a partner.",
      ],
    },
    {
      id: "citing",
      heading: "How do we attribute a fact?",
      body: [
        "On medical pages you will find numbered sources at the end of the page, with each important fact tied to its source and a last-consulted date. External links to sources open in a new tab. If a source changes, we update the page.",
        "In the medical assistant, sources appear under the answer when the assistant searches before replying.",
      ],
    },
    {
      id: "limits",
      heading: "Limits of sources",
      body: [
        "Information can differ from one country to another: a medicine may be registered under a different name or strength, and a leaflet may differ between authorities. So the leaflet in the box you hold and the instructions of your doctor and pharmacist remain the reference, and we always ask you to check before use.",
      ],
    },
  ],
  faq: [],
  related: ["/editorial-policy", "/medical-review", "/about", "/disclaimer"],
  updatedAt: "2026-10-20",
};
