import type { TocEntry, ContentFlags } from "../../schemas/content.js";
import type { MediaVariant } from "../../schemas/media.js";
import type { ContentLocale, ContentType } from "../constants.js";

/** What the renderer needs to know about a library image (the API loads it; the renderer stays pure). */
export interface RenderMedia {
  id: string;
  width: number;
  height: number;
  /** Alt text in the content's locale; the markdown alt wins when it is not empty. */
  alt: string;
  caption: string | null;
  credit?: string | null;
  /** Explicitly marked decorative in the library: rendered with `alt=""` and exempt from the alt gate. */
  decorative?: boolean;
  variants: readonly MediaVariant[];
}

/** A page the auto-linker may point at: a drug, a glossary entry or another content page. */
export interface AutoLinkTarget {
  kind: "drug" | "glossary" | "content";
  slug: string;
  /** Names that trigger the link (Arabic and Latin spellings); matched with letter-variant tolerance. */
  terms: readonly string[];
  /** Site-relative path. */
  path: string;
  /** `title` attribute of the link. */
  title: string;
}

export interface RenderResolvers {
  media(ids: string[]): Promise<Map<string, RenderMedia>>;
  drug(slug: string): Promise<{ name: string; path: string } | null>;
  glossary(slug: string): Promise<{ term: string; path: string; definition: string } | null>;
  autoLinkTargets: readonly AutoLinkTarget[];
}

export interface RenderSettings {
  autoLink: { enabled: boolean; maxPerTarget: number; minWordsBetween: number };
  /** External links to these hosts (and their subdomains) are not `nofollow`. */
  dofollowDomains: readonly string[];
}

export interface RenderInput {
  bodyMd: string;
  type: ContentType;
  locale: ContentLocale;
  flags: Pick<ContentFlags, "autoLink"> & Partial<Pick<ContentFlags, "sponsored">>;
  settings: RenderSettings;
  resolvers: RenderResolvers;
  /** Origin images may load from, such as `https://media.wasfa.online`; any other image host is refused. */
  mediaOrigin: string;
}

export interface RenderWarning {
  code: string;
  detail?: string;
}

export interface RenderedHeading {
  level: 2 | 3 | 4;
  id: string;
  text: string;
}

export interface RenderedLink {
  href: string;
  internal: boolean;
  /** Space-separated rel tokens ("" for internal links). */
  rel: string;
  anchor: string;
}

export interface RenderedImage {
  mediaId: string;
  alt: string;
  decorative: boolean;
}

export interface RenderedEntity {
  kind: "drug" | "glossary";
  slug: string;
  source: "explicit" | "auto";
}

export interface RenderResult {
  html: string;
  toc: TocEntry[];
  headings: RenderedHeading[];
  wordCount: number;
  readingMinutes: number;
  links: RenderedLink[];
  images: RenderedImage[];
  entities: RenderedEntity[];
  warnings: RenderWarning[];
  /** 512-byte MinHash signature of the plain text (see `content/similarity`). */
  minhash: Uint8Array;
}
