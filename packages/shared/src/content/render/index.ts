import { toString as hastToString } from "mdast-util-to-string";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { minhashSignature } from "../similarity.js";
import { headingIdFactory } from "../slug.js";
import { countWords, readingMinutes, stripBidiControls } from "../text.js";

import { autoLink, explicitEntityLinks, noLinkNodes } from "./autolink.js";
import { buildCta, buildFigure } from "./hast-build.js";
import {
  CALLOUT_LABELS,
  FOOTNOTES_LABEL,
  FOOTNOTE_BACK_LABEL,
  type CalloutKind,
} from "./labels.js";
import { BLOCK_HOSTS, plainText, rewriteChildren, text, type MNode } from "./mnode.js";
import { classifyHref, externalRel, isUnderOrigin, srcsetUrls } from "./policy.js";
import { SANITIZE_SCHEMA } from "./sanitize-schema.js";
import { ENTITY_SLUG, extractTokens, restoreTokens, splitTokens, type Token } from "./tokens.js";

import type {
  RenderInput,
  RenderMedia,
  RenderResult,
  RenderWarning,
  RenderedEntity,
  RenderedHeading,
  RenderedImage,
  RenderedLink,
} from "./types.js";
import type { TocEntry } from "../../schemas/content.js";
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";

export type {
  AutoLinkTarget,
  RenderInput,
  RenderMedia,
  RenderResolvers,
  RenderResult,
  RenderSettings,
  RenderWarning,
  RenderedEntity,
  RenderedHeading,
  RenderedImage,
  RenderedLink,
} from "./types.js";
export { SANITIZE_SCHEMA } from "./sanitize-schema.js";

/*
 * Markdown -> sanitised HTML (CONTENT-PLATFORM §7 and §11.3). Runs at save time in the API; the public
 * page injects the stored result, so no Markdown or sanitiser code reaches the browser. Pure apart
 * from the injected resolvers, and deterministic: the same input gives byte-identical HTML.
 *
 * Stages: strip bidi/NUL -> cut `{{…}}` tokens -> parse (CommonMark, GFM, directives) -> normalise
 * (drop raw HTML, neutralise task lists) -> resolve media and entities -> expand tokens -> figures ->
 * headings -> auto-link -> callouts -> mdast-to-hast WITHOUT raw HTML -> link policy -> allow-list
 * sanitise -> image-origin check -> heading ids/TOC -> stringify.
 */

const CALLOUTS = new Set<string>(["note", "warning", "tip"]);
const MAX_UNKNOWN_DETAIL = 100;

class Warnings {
  private readonly seen = new Set<string>();
  readonly list: RenderWarning[] = [];

  add(code: string, detail?: string): void {
    const clipped = detail === undefined ? undefined : detail.slice(0, MAX_UNKNOWN_DETAIL);
    const key = `${code}|${clipped ?? ""}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(clipped === undefined ? { code } : { code, detail: clipped });
  }
}

type Resolved<T> = Map<string, T | null>;

interface Context {
  input: RenderInput;
  source: string;
  tokens: Token[];
  warnings: Warnings;
  media: Map<string, RenderMedia>;
  drugs: Resolved<{ name: string; path: string }>;
  glossary: Resolved<{ term: string; path: string; definition: string }>;
  images: RenderedImage[];
  entities: RenderedEntity[];
  /** Nodes that become block-level HTML (figures, the CTA) and must be lifted out of their paragraph. */
  blocks: WeakSet<MNode>;
  ctaUsed: boolean;
}

function blockNode(element: Element): MNode {
  return {
    type: "paragraph",
    children: [],
    data: { hName: element.tagName, hProperties: element.properties, hChildren: element.children },
  };
}

function walk(node: MNode, fn: (node: MNode) => void): void {
  fn(node);
  node.children?.forEach((child) => walk(child, fn));
}

// ---------------------------------------------------------------------------------------------
// mdast normalisation
// ---------------------------------------------------------------------------------------------

function normalize(node: MNode, ctx: Context, definitions: Map<string, MNode>): void {
  rewriteChildren(node, (child) => {
    switch (child.type) {
      case "html":
        ctx.warnings.add("raw_html_dropped");
        return [];
      case "textDirective":
      case "leafDirective": {
        // `foo:bar` in prose is read as a directive by remark-directive; give the author's text back.
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        const literal = text(
          start !== undefined && end !== undefined
            ? ctx.source.slice(start, end)
            : `:${child.name ?? ""}`,
        );
        if (child.type === "textDirective") return [literal];
        ctx.warnings.add("unknown_directive", child.name);
        return [{ type: "paragraph", children: [literal] }];
      }
      case "containerDirective": {
        normalize(child, ctx, definitions);
        if (child.name !== undefined && CALLOUTS.has(child.name)) return [child];
        ctx.warnings.add("unknown_directive", child.name);
        return child.children ?? [];
      }
      case "code":
      case "inlineCode":
        child.value = restoreTokens(child.value ?? "", ctx.tokens);
        if (child.lang != null) child.lang = restoreTokens(child.lang, ctx.tokens);
        child.meta = null;
        return [child];
      case "link":
      case "definition":
      case "image":
        if (child.url !== undefined) child.url = restoreTokens(child.url, ctx.tokens);
        if (child.title != null) child.title = restoreTokens(child.title, ctx.tokens);
        if (child.alt != null) child.alt = restoreTokens(child.alt, ctx.tokens);
        normalize(child, ctx, definitions);
        return [child];
      case "imageReference": {
        // `![alt][ref]` would otherwise reach remark-rehype with the definition's (possibly external) URL.
        const definition = definitions.get(child.identifier ?? "");
        if (definition === undefined) return [];
        return [
          {
            type: "image",
            url: definition.url ?? "",
            title: definition.title ?? null,
            alt: child.alt ?? "",
          },
        ];
      }
      case "listItem":
        // Task lists are off: keep the author's "[ ]" / "[x]" as literal text instead of a checkbox.
        if (child.checked != null) {
          const marker = child.checked ? "[x] " : "[ ] ";
          child.checked = null;
          const first = child.children?.[0];
          if (first?.type === "paragraph")
            first.children = [text(marker), ...(first.children ?? [])];
        }
        normalize(child, ctx, definitions);
        return [child];
      default:
        normalize(child, ctx, definitions);
        return [child];
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Tokens, images, blocks
// ---------------------------------------------------------------------------------------------

function entityLink(
  kind: "drug" | "glossary",
  slug: string,
  label: string,
  url: string,
  title: string,
  ctx: Context,
): MNode {
  const node: MNode = {
    type: "link",
    url,
    title,
    children: [text(label)],
    data: { hProperties: { className: ["entity-link"], dataEntity: kind } },
  };
  explicitEntityLinks.set(node, { kind, slug });
  ctx.entities.push({ kind, slug, source: "explicit" });
  return node;
}

function expandToken(token: Token, ctx: Context, inLink: boolean): MNode[] {
  switch (token.kind) {
    case "nolink": {
      if (token.arg === "") return [];
      const node = text(token.arg);
      noLinkNodes.add(node);
      return [node];
    }
    case "cta": {
      if (token.arg.toLowerCase() !== "analyze") {
        ctx.warnings.add("unknown_cta", token.arg);
        return [];
      }
      if (ctx.ctaUsed) {
        ctx.warnings.add("cta_duplicate");
        return [];
      }
      ctx.ctaUsed = true;
      const node = blockNode(buildCta(ctx.input.locale));
      ctx.blocks.add(node);
      return [node];
    }
    case "drug":
    case "glossary": {
      const slug = token.arg;
      if (!ENTITY_SLUG.test(slug)) {
        ctx.warnings.add("invalid_directive", token.kind);
        return [text(token.raw)];
      }
      if (token.kind === "drug") {
        const drug = ctx.drugs.get(slug);
        if (drug === undefined || drug === null) {
          ctx.warnings.add("unknown_drug", slug);
          return [text(token.label ?? slug)];
        }
        const label = token.label ?? drug.name;
        return [inLink ? text(label) : entityLink("drug", slug, label, drug.path, drug.name, ctx)];
      }
      const entry = ctx.glossary.get(slug);
      if (entry === undefined || entry === null) {
        ctx.warnings.add("unknown_glossary", slug);
        return [text(token.label ?? slug)];
      }
      const label = token.label ?? entry.term;
      return [
        inLink
          ? text(label)
          : entityLink("glossary", slug, label, entry.path, entry.definition, ctx),
      ];
    }
  }
}

function expand(node: MNode, ctx: Context, inLink: boolean): void {
  rewriteChildren(node, (child) => {
    if (child.type === "text") {
      const pieces = splitTokens(child.value ?? "", ctx.tokens);
      if (pieces.every((piece) => piece.type === "text")) return [child];
      return pieces.flatMap((piece) =>
        piece.type === "text" ? [text(piece.value)] : expandToken(piece.token, ctx, inLink),
      );
    }
    expand(child, ctx, inLink || child.type === "link" || child.type === "linkReference");
    return [child];
  });
}

function convertImages(node: MNode, ctx: Context): void {
  rewriteChildren(node, (child) => {
    if (child.type !== "image") {
      convertImages(child, ctx);
      return [child];
    }
    const url = (child.url ?? "").trim();
    const media = /^media:/i.test(url) ? url.slice("media:".length) : null;
    if (media === null) {
      // Only library images render: an external URL would leak the reader's IP and bypass the CSP.
      ctx.warnings.add("external_image_refused", url.replace(/\s+/g, " "));
      return [];
    }
    const asset = /^[A-Za-z0-9-]{1,64}$/.test(media) ? ctx.media.get(media) : undefined;
    if (asset === undefined) {
      ctx.warnings.add("unknown_media", media);
      return [];
    }
    const decorative = asset.decorative === true;
    const alt = decorative ? "" : (child.alt ?? "").trim() || asset.alt.trim();
    const caption = (child.title ?? "").trim() || asset.caption;
    const figure = buildFigure({ media: asset, alt, caption, mediaOrigin: ctx.input.mediaOrigin });
    if (figure === null) {
      ctx.warnings.add("media_not_ready", media);
      return [];
    }
    ctx.images.push({ mediaId: asset.id, alt, decorative });
    const block = blockNode(figure);
    ctx.blocks.add(block);
    return [block];
  });
}

/** Lifts figures and the CTA out of the paragraph they were written in; HTML forbids `<p><figure>`. */
function trimRun(run: MNode[]): MNode[] {
  const out = [...run];
  const first = out[0];
  if (first?.type === "text") out[0] = text((first.value ?? "").trimStart());
  const last = out[out.length - 1];
  if (last?.type === "text") out[out.length - 1] = text((last.value ?? "").trimEnd());
  return out.filter((part) => part.type !== "text" || (part.value ?? "") !== "");
}

function hoistBlocks(node: MNode, ctx: Context): void {
  rewriteChildren(node, (child) => {
    if (child.type !== "paragraph" || !child.children?.some((part) => ctx.blocks.has(part))) {
      hoistBlocks(child, ctx);
      return [child];
    }
    const out: MNode[] = [];
    let run: MNode[] = [];
    const flush = (): void => {
      const trimmed = trimRun(run);
      if (trimmed.length > 0) out.push({ type: "paragraph", children: trimmed });
      run = [];
    };
    for (const part of child.children) {
      if (ctx.blocks.has(part)) {
        flush();
        out.push(part);
      } else run.push(part);
    }
    flush();
    return out;
  });
}

/** Paragraphs emptied by a removed image, CTA or token have nothing to show. */
function dropEmptyParagraphs(node: MNode, ctx: Context): void {
  rewriteChildren(node, (child) => {
    if (
      child.type === "paragraph" &&
      !ctx.blocks.has(child) &&
      trimRun(child.children ?? []).length === 0
    )
      return [];
    dropEmptyParagraphs(child, ctx);
    return [child];
  });
}

/** A figure or CTA that ended up inside a heading, link or table cell has no valid place: drop it. */
function dropMisplacedBlocks(node: MNode, ctx: Context): void {
  rewriteChildren(node, (child) => {
    if (ctx.blocks.has(child) && !BLOCK_HOSTS.has(node.type)) {
      ctx.warnings.add("block_in_inline");
      return [];
    }
    dropMisplacedBlocks(child, ctx);
    return [child];
  });
}

// ---------------------------------------------------------------------------------------------
// hast passes
// ---------------------------------------------------------------------------------------------

function rewriteElements(
  parent: HastRoot | Element,
  fn: (el: Element) => ElementContent[] | undefined,
): void {
  const out: ElementContent[] = [];
  for (const child of parent.children as ElementContent[]) {
    if (child.type !== "element") {
      out.push(child);
      continue;
    }
    rewriteElements(child, fn);
    out.push(...(fn(child) ?? [child]));
  }
  parent.children = out;
}

const textOf = (node: Element): string =>
  hastToString(node as unknown as Parameters<typeof hastToString>[0]);

function applyLinkPolicy(tree: HastRoot, ctx: Context): void {
  const sponsored = ctx.input.flags.sponsored === true;
  rewriteElements(tree, (el) => {
    if (el.tagName !== "a") return undefined;
    const raw = el.properties["href"];
    const cls = typeof raw === "string" ? classifyHref(raw) : ({ kind: "unsafe" } as const);
    if (cls.kind === "unsafe") {
      ctx.warnings.add(
        "unsafe_link_removed",
        typeof raw === "string" ? raw.slice(0, 40) : undefined,
      );
      // `<javascript:…>` autolinks have the URL itself as text: drop it instead of printing the payload.
      const label = textOf(el).trim();
      return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(label) ? [] : el.children;
    }
    el.properties["href"] = cls.href;
    if (cls.kind === "external") {
      el.properties["rel"] = externalRel(cls.host, ctx.input.settings.dofollowDomains, sponsored);
    } else {
      delete el.properties["rel"];
    }
    return undefined;
  });
}

/** Defence in depth after the allow-list: no image or source may point outside the media origin. */
function enforceMediaOrigin(tree: HastRoot, ctx: Context): void {
  const origin = ctx.input.mediaOrigin;
  const valid = (el: Element): boolean => {
    if (el.tagName === "img") {
      const src = el.properties["src"];
      return typeof src === "string" && isUnderOrigin(src, origin);
    }
    if (el.tagName === "source") {
      const set = el.properties["srcSet"];
      return typeof set === "string" && srcsetUrls(set).every((url) => isUnderOrigin(url, origin));
    }
    return true;
  };
  const hasBad = (el: Element): boolean =>
    !valid(el) || el.children.some((child) => child.type === "element" && hasBad(child));
  rewriteElements(tree, (el) => {
    if (el.tagName === "figure" && hasBad(el)) {
      ctx.warnings.add("external_image_refused");
      return [];
    }
    // A stray image outside our own figures cannot be produced by the pipeline; drop it if it appears.
    if ((el.tagName === "img" || el.tagName === "source" || el.tagName === "picture") && !valid(el))
      return [];
    return undefined;
  });
}

/**
 * Angle brackets inside an attribute value are harmless to a browser but trip up every naive consumer
 * (a WAF, an HTML minifier, a later `innerHTML` of the markup), so titles and alts never carry them.
 */
function stripAngleBrackets(tree: HastRoot): void {
  visit(tree, "element", (el: Element) => {
    for (const [name, value] of Object.entries(el.properties)) {
      if (typeof value === "string" && /[<>]/.test(value))
        el.properties[name] = value.replace(/[<>]/g, "");
    }
  });
}

function assignHeadingIds(tree: HastRoot): RenderedHeading[] {
  const ids = headingIdFactory();
  ids.reserve("footnote-label");
  const headings: RenderedHeading[] = [];
  visit(tree, "element", (el: Element) => {
    const level = /^h([2-4])$/.exec(el.tagName)?.[1];
    if (level === undefined) return;
    const label = textOf(el).replace(/\s+/g, " ").trim();
    const existing = el.properties["id"];
    const id =
      typeof existing === "string" && existing === "footnote-label" ? existing : ids.next(label);
    el.properties["id"] = id;
    headings.push({ level: Number(level) as 2 | 3 | 4, id, text: label });
  });
  return headings;
}

function collectLinks(tree: HastRoot): RenderedLink[] {
  const links: RenderedLink[] = [];
  const inCta = new WeakSet<Element>();
  visit(tree, "element", (el: Element) => {
    if (el.tagName === "aside" && el.properties["dataCta"] !== undefined) {
      visit(el, "element", (inner: Element) => {
        inCta.add(inner);
      });
    }
  });
  visit(tree, "element", (el: Element) => {
    if (el.tagName !== "a" || inCta.has(el)) return;
    const href = el.properties["href"];
    if (typeof href !== "string" || href.startsWith("#")) return;
    const rel = el.properties["rel"];
    links.push({
      href,
      internal: href.startsWith("/"),
      rel: Array.isArray(rel) ? rel.join(" ") : typeof rel === "string" ? rel : "",
      anchor: textOf(el).replace(/\s+/g, " ").trim(),
    });
  });
  return links;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export async function renderContent(input: RenderInput): Promise<RenderResult> {
  const warnings = new Warnings();

  const stripped = stripBidiControls(input.bodyMd);
  if (stripped.removed) warnings.add("bidi_controls_removed");
  // NUL is meaningless in text and some parsers treat it as a terminator.
  const { text: source, tokens } = extractTokens(
    stripped.text.replaceAll(String.fromCharCode(0), ""),
  );

  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);
  const tree = parser.parse(source) as unknown as MNode;

  const ctx: Context = {
    input,
    source,
    tokens,
    warnings,
    media: new Map(),
    drugs: new Map(),
    glossary: new Map(),
    images: [],
    entities: [],
    blocks: new WeakSet(),
    ctaUsed: false,
  };

  const definitions = new Map<string, MNode>();
  walk(tree, (node) => {
    if (
      node.type === "definition" &&
      node.identifier !== undefined &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node);
    }
  });
  normalize(tree, ctx, definitions);

  // Collect what the resolvers must answer, then ask once for all of it.
  const mediaIds = new Set<string>();
  walk(tree, (node) => {
    if (node.type === "image" && /^media:/i.test((node.url ?? "").trim())) {
      const id = (node.url ?? "").trim().slice("media:".length);
      if (/^[A-Za-z0-9-]{1,64}$/.test(id)) mediaIds.add(id);
    }
  });
  const drugSlugs = new Set<string>();
  const glossarySlugs = new Set<string>();
  for (const token of tokens) {
    if (!ENTITY_SLUG.test(token.arg)) continue;
    if (token.kind === "drug") drugSlugs.add(token.arg);
    else if (token.kind === "glossary") glossarySlugs.add(token.arg);
  }
  const { resolvers } = input;
  const [media, drugs, glossary] = await Promise.all([
    mediaIds.size > 0
      ? resolvers.media([...mediaIds])
      : Promise.resolve(new Map<string, RenderMedia>()),
    Promise.all([...drugSlugs].map(async (slug) => [slug, await resolvers.drug(slug)] as const)),
    Promise.all(
      [...glossarySlugs].map(async (slug) => [slug, await resolvers.glossary(slug)] as const),
    ),
  ]);
  ctx.media = media;
  ctx.drugs = new Map(drugs);
  ctx.glossary = new Map(glossary);

  expand(tree, ctx, false);
  convertImages(tree, ctx);
  hoistBlocks(tree, ctx);
  dropMisplacedBlocks(tree, ctx);
  dropEmptyParagraphs(tree, ctx);

  // Headings: `#` is the page title's job, so it becomes h2; levels are kept within h2-h4.
  let previousLevel = 1;
  walk(tree, (node) => {
    if (node.type !== "heading") return;
    let depth = node.depth ?? 2;
    if (depth === 1) {
      warnings.add("h1_in_body");
      depth = 2;
    } else if (depth > 4) {
      warnings.add("heading_clamped", `h${String(depth)}`);
      depth = 4;
    }
    if (depth > previousLevel + 1)
      warnings.add("heading_skip", `h${String(previousLevel)}-h${String(depth)}`);
    node.depth = depth;
    previousLevel = depth;
  });

  if (input.flags.autoLink && input.settings.autoLink.enabled) {
    ctx.entities.push(
      ...autoLink(tree, {
        targets: resolvers.autoLinkTargets,
        maxPerTarget: input.settings.autoLink.maxPerTarget,
        minWordsBetween: input.settings.autoLink.minWordsBetween,
      }),
    );
  }

  // Counted before callout titles and the CTA are added: only the author's words count.
  const plain = plainText(tree).replace(/\s+/g, " ").trim();
  const wordCount = countWords(plain);

  walk(tree, (node) => {
    if (node.type !== "containerDirective" || node.name === undefined) return;
    const kind = node.name as CalloutKind;
    const label =
      node.children?.[0]?.data?.["directiveLabel"] === true ? node.children[0] : undefined;
    const titleChildren = label?.children ?? [text(CALLOUT_LABELS[input.locale][kind])];
    node.children = [
      { type: "paragraph", children: [{ type: "strong", children: titleChildren }] },
      ...(label === undefined ? (node.children ?? []) : (node.children ?? []).slice(1)),
    ];
    node.data = {
      ...node.data,
      hName: "aside",
      hProperties: { className: ["callout", `callout-${kind}`], role: "note" },
    };
  });

  const toHast = unified().use(remarkRehype, {
    clobberPrefix: "",
    footnoteLabel: FOOTNOTES_LABEL[input.locale],
    footnoteLabelTagName: "h2",
    footnoteLabelProperties: {},
    footnoteBackLabel: (index: number) => FOOTNOTE_BACK_LABEL[input.locale](index),
  });
  const rawHast = (await toHast.run(tree as unknown as MdastRoot)) as HastRoot;

  applyLinkPolicy(rawHast, ctx);
  const sanitized = (await unified().use(rehypeSanitize, SANITIZE_SCHEMA).run(rawHast)) as HastRoot;
  enforceMediaOrigin(sanitized, ctx);
  stripAngleBrackets(sanitized);
  const headings = assignHeadingIds(sanitized);
  const links = collectLinks(sanitized);
  const html = unified().use(rehypeStringify).stringify(sanitized);

  // Every heading is h2-h4 by construction, so the TOC lists them all.
  const toc: TocEntry[] = headings.map((heading) => ({
    id: heading.id,
    text: heading.text.slice(0, 300),
    level: heading.level,
  }));

  const seenEntities = new Set<string>();
  const entities = ctx.entities.filter((entity) => {
    const key = `${entity.kind}:${entity.slug}:${entity.source}`;
    if (seenEntities.has(key)) return false;
    seenEntities.add(key);
    return true;
  });

  return {
    html,
    toc,
    headings,
    wordCount,
    readingMinutes: readingMinutes(wordCount),
    links,
    images: ctx.images,
    entities,
    warnings: warnings.list,
    minhash: minhashSignature(plain),
  };
}
