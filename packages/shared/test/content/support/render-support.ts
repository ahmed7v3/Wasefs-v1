import type {
  AutoLinkTarget,
  RenderInput,
  RenderMedia,
  RenderResolvers,
} from "../../../src/content/render/index.js";

export const MEDIA_ORIGIN = "https://media.wasfa.online";
export const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
export const DECORATIVE_ID = "22222222-2222-4222-8222-222222222222";
export const NOT_READY_ID = "33333333-3333-4333-8333-333333333333";

export const MEDIA: Record<string, RenderMedia> = {
  [MEDIA_ID]: {
    id: MEDIA_ID,
    width: 1600,
    height: 900,
    alt: "قرص دواء على طاولة",
    caption: null,
    credit: null,
    variants: [
      { format: "avif", width: 640, key: "media/aa11/640.avif", bytes: 20_000 },
      { format: "avif", width: 1280, key: "media/aa11/1280.avif", bytes: 60_000 },
      { format: "webp", width: 640, key: "media/aa11/640.webp", bytes: 30_000 },
      { format: "webp", width: 1280, key: "media/aa11/1280.webp", bytes: 90_000 },
      { format: "jpeg", width: 1200, key: "media/aa11/1200.jpg", bytes: 120_000 },
    ],
  },
  [DECORATIVE_ID]: {
    id: DECORATIVE_ID,
    width: 800,
    height: 400,
    alt: "",
    caption: null,
    decorative: true,
    variants: [{ format: "jpeg", width: 800, key: "media/bb22/800.jpg", bytes: 50_000 }],
  },
  [NOT_READY_ID]: {
    id: NOT_READY_ID,
    width: 800,
    height: 400,
    alt: "لم تجهز",
    caption: null,
    variants: [],
  },
};

export const DRUGS: Record<string, { name: string; path: string }> = {
  paracetamol: { name: "باراسيتامول", path: "/drugs/paracetamol" },
  ibuprofen: { name: "Ibuprofen", path: "/en/drugs/ibuprofen" },
};

export const GLOSSARY: Record<string, { term: string; path: string; definition: string }> = {
  bid: { term: "BID", path: "/glossary/bid", definition: "مرتين يومي\u064Bا" },
  prn: { term: "PRN", path: "/en/glossary/prn", definition: "as needed" },
};

export const TARGETS: AutoLinkTarget[] = [
  {
    kind: "drug",
    slug: "paracetamol",
    terms: ["باراسيتامول", "Paracetamol", "أسيتامينوفين"],
    path: "/drugs/paracetamol",
    title: "باراسيتامول",
  },
  {
    kind: "drug",
    slug: "ibuprofen",
    terms: ["ايبوبروفين", "Ibuprofen"],
    path: "/drugs/ibuprofen",
    title: "ايبوبروفين",
  },
  {
    kind: "glossary",
    slug: "bid",
    terms: ["مرتين يوميا"],
    path: "/glossary/bid",
    title: "مرتين يومي\u064Bا",
  },
  {
    kind: "content",
    slug: "headache-guide",
    terms: ["دليل الصداع"],
    path: "/guides/headache-guide",
    title: "دليل الصداع",
  },
];

export interface Calls {
  media: string[][];
  drug: string[];
  glossary: string[];
}

export function resolvers(targets: AutoLinkTarget[] = TARGETS): {
  resolvers: RenderResolvers;
  calls: Calls;
} {
  const calls: Calls = { media: [], drug: [], glossary: [] };
  return {
    calls,
    resolvers: {
      media: (ids) => {
        calls.media.push(ids);
        const found = new Map<string, RenderMedia>();
        for (const id of ids) {
          const media = MEDIA[id];
          if (media !== undefined) found.set(id, media);
        }
        return Promise.resolve(found);
      },
      drug: (slug) => {
        calls.drug.push(slug);
        return Promise.resolve(DRUGS[slug] ?? null);
      },
      glossary: (slug) => {
        calls.glossary.push(slug);
        return Promise.resolve(GLOSSARY[slug] ?? null);
      },
      autoLinkTargets: targets,
    },
  };
}

export function renderInput(bodyMd: string, overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    bodyMd,
    type: "article",
    locale: "ar",
    flags: { autoLink: false },
    settings: {
      autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 120 },
      dofollowDomains: ["who.int", "nih.gov"],
    },
    resolvers: resolvers().resolvers,
    mediaOrigin: MEDIA_ORIGIN,
    ...overrides,
  };
}
