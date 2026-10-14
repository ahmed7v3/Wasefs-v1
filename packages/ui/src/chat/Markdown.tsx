import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "../cn";

import type { Components } from "react-markdown";

/*
 * Model output rendered as safe, RTL-aware HTML (Task 2.11). Raw HTML in the text is never
 * interpreted (react-markdown shows it as text), the tree is sanitized on top as a second wall, and
 * links are limited to http(s)/mailto. Code is always LTR; runs of Latin text and numbers inside
 * Arabic sentences are wrapped in <bdi> so "Paracetamol 500 mg" keeps its order (DESIGN-SYSTEM §4.5).
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** A Latin word or number, joined to its neighbours by the usual in-word punctuation and spaces. */
const LTR_RUN = /[A-Za-z0-9]+(?:[ .,:/%+\-_'’][A-Za-z0-9]+)*%?/g;
/** Elements whose text must stay as it is: code is already LTR, <bdi> is already wrapped. */
const SKIPPED = new Set(["code", "pre", "bdi"]);

function wrapLtrRuns(value: string): HastNode[] | null {
  const parts: HastNode[] = [];
  let last = 0;
  for (const match of value.matchAll(LTR_RUN)) {
    const start = match.index;
    if (start > last) parts.push({ type: "text", value: value.slice(last, start) });
    parts.push({
      type: "element",
      tagName: "bdi",
      properties: {},
      children: [{ type: "text", value: match[0] }],
    });
    last = start + match[0].length;
  }
  if (parts.length === 0) return null;
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

function wrapTree(node: HastNode): void {
  if (!node.children) return;
  if (node.type === "element" && node.tagName !== undefined && SKIPPED.has(node.tagName)) return;
  const next: HastNode[] = [];
  for (const child of node.children) {
    const wrapped = child.type === "text" && child.value ? wrapLtrRuns(child.value) : null;
    if (wrapped) {
      next.push(...wrapped);
    } else {
      wrapTree(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** Runs after the sanitizer (which would drop <bdi>). Exported for the unit test. */
export function rehypeBidiRuns() {
  return (tree: HastNode): void => {
    wrapTree(tree);
  };
}

const SAFE_LINK = /^(https?:|mailto:)/i;

const components: Components = {
  a({ href, children }) {
    if (!href || !SAFE_LINK.test(href)) return <span>{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
      >
        {children}
      </a>
    );
  },
  // A bare `<img>` would call out to a third party from the page; the assistant never needs one.
  img({ alt }) {
    return alt ? <span>{alt}</span> : null;
  },
  pre({ children }) {
    return (
      <pre
        dir="ltr"
        className="my-3 overflow-x-auto rounded-md bg-neutral-100 p-3 text-start text-sm"
      >
        {children}
      </pre>
    );
  },
  code({ children, className }) {
    return (
      <code dir="ltr" className={cn("font-mono text-[0.9em]", className)}>
        {children}
      </code>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-start text-sm">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="border border-border bg-primary-soft px-3 py-2 text-start font-semibold">
        {children}
      </th>
    );
  },
  td({ children }) {
    return <td className="border border-border px-3 py-2 text-start">{children}</td>;
  },
  ul({ children }) {
    return <ul className="my-2 list-disc ps-6">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal ps-6">{children}</ol>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-s-4 border-accent ps-4 text-text-muted">
        {children}
      </blockquote>
    );
  },
  h1: ({ children }) => <h3 className="mt-4 mb-2 font-heading text-xl font-bold">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 font-heading text-xl font-bold">{children}</h3>,
  h3: ({ children }) => (
    <h4 className="mt-3 mb-2 font-heading text-lg font-semibold">{children}</h4>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-2 font-heading text-lg font-semibold">{children}</h4>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
};

export interface MarkdownProps {
  children: string;
  className?: string | undefined;
}

/** Re-parsing is cheap for an answer-sized string; `memo` keeps finished messages from re-rendering. */
export const Markdown = memo(function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("break-words text-base leading-8", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeBidiRuns]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
