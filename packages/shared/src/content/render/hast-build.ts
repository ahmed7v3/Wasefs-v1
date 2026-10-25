import { MEDIA_FORMAT_MIME, type MediaFormat } from "../../schemas/media.js";

import { CTA_HREF, CTA_LABELS } from "./labels.js";
import { originOf } from "./policy.js";

import type { RenderMedia } from "./types.js";
import type { ContentLocale } from "../constants.js";
import type { Element, ElementContent, Properties } from "hast";

/** Builders for the HTML the renderer writes itself (library figures and the CTA block). */

export function el(
  tagName: string,
  properties: Properties,
  ...children: ElementContent[]
): Element {
  return { type: "element", tagName, properties, children };
}

export const textNode = (value: string): ElementContent => ({ type: "text", value });

/** Width the article column occupies; lets the browser pick the right variant before layout. */
const BODY_IMAGE_SIZES = "(min-width: 768px) 720px, 100vw";
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
const FORMAT_PREFERENCE: readonly MediaFormat[] = ["jpeg", "webp", "avif"];

function variantUrl(origin: string, key: string): string | null {
  return SAFE_KEY.test(key) && !key.includes("..") ? `${origin}/${key}` : null;
}

/**
 * `<figure><picture>…</picture><figcaption>…</figcaption></figure>` for a ready library image, or
 * null when it has no usable variant (still processing). All URLs are under the media origin.
 */
export function buildFigure(input: {
  media: RenderMedia;
  alt: string;
  caption: string | null;
  mediaOrigin: string;
}): Element | null {
  const { media, alt, mediaOrigin } = input;
  const origin = originOf(mediaOrigin);
  if (origin === null) return null;

  const byFormat = new Map<MediaFormat, { width: number; url: string }[]>();
  for (const variant of media.variants) {
    const url = variantUrl(origin, variant.key);
    if (url === null) continue;
    const list = byFormat.get(variant.format) ?? [];
    list.push({ width: variant.width, url });
    byFormat.set(variant.format, list);
  }
  for (const list of byFormat.values()) list.sort((a, b) => a.width - b.width);

  // The <img> is the fallback for browsers that read no <source>: JPEG near 1200 px, else the best we have.
  const fallbackFormat = FORMAT_PREFERENCE.find(
    (format) => (byFormat.get(format)?.length ?? 0) > 0,
  );
  if (fallbackFormat === undefined) return null;
  const fallbackList = byFormat.get(fallbackFormat) ?? [];
  const fallback =
    fallbackList.find((candidate) => candidate.width >= 1200) ??
    fallbackList[fallbackList.length - 1];
  if (fallback === undefined) return null;

  const sources: Element[] = [];
  for (const format of ["avif", "webp"] as const) {
    const list = byFormat.get(format);
    if (list === undefined || list.length === 0) continue;
    sources.push(
      el("source", {
        type: MEDIA_FORMAT_MIME[format],
        srcSet: list.map((candidate) => `${candidate.url} ${String(candidate.width)}w`).join(", "),
        sizes: BODY_IMAGE_SIZES,
      }),
    );
  }

  const ratio = media.width > 0 ? media.height / media.width : 0.5625;
  const img = el("img", {
    src: fallback.url,
    width: fallback.width,
    height: Math.max(1, Math.round(fallback.width * ratio)),
    alt,
    loading: "lazy",
    decoding: "async",
  });
  const children: ElementContent[] = [el("picture", {}, ...sources, img)];
  const caption = [input.caption, media.credit].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  if (caption.length > 0) children.push(el("figcaption", {}, textNode(caption.join(" — "))));
  return el("figure", {}, ...children);
}

/** The single product block: a short prompt and a link to sign-up. Fixed markup, never user input. */
export function buildCta(locale: ContentLocale): Element {
  const labels = CTA_LABELS[locale];
  return el(
    "aside",
    { className: ["content-cta"], dataCta: "analyze" },
    el("p", {}, textNode(labels.text)),
    el("p", {}, el("a", { href: CTA_HREF }, textNode(labels.action))),
  );
}
