/*
 * A deliberately loose view of an mdast node. The directive node types come from plugin type
 * augmentations that are not importable under pnpm's strict layout, and the renderer rewrites the tree
 * heavily, so one structural type keeps every transform honest without `any`.
 */
export interface MNode {
  type: string;
  children?: MNode[];
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  name?: string;
  depth?: number;
  checked?: boolean | null;
  identifier?: string;
  lang?: string | null;
  meta?: string | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: Record<string, unknown>;
}

export const text = (value: string): MNode => ({ type: "text", value });

/** Rewrites `node.children` in place; `fn` returns the replacement list for each child (empty = remove). */
export function rewriteChildren(node: MNode, fn: (child: MNode, index: number) => MNode[]): void {
  if (node.children === undefined) return;
  const next: MNode[] = [];
  node.children.forEach((child, index) => next.push(...fn(child, index)));
  node.children = next;
}

/** Node types whose children are blocks (so text from siblings must not run together). */
const BLOCK_PARENTS = new Set([
  "root",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "containerDirective",
  "footnoteDefinition",
]);
export const isBlockParent = (type: string): boolean => BLOCK_PARENTS.has(type);

/** Block containers a figure or CTA may sit directly in. */
export const BLOCK_HOSTS = new Set([
  "root",
  "blockquote",
  "listItem",
  "containerDirective",
  "footnoteDefinition",
]);

/** Plain text of a subtree with a space between blocks; images contribute nothing. */
export function plainText(node: MNode): string {
  if (node.type === "image" || node.type === "imageReference") return "";
  if (node.type === "break") return " ";
  if (node.children === undefined) return node.value ?? "";
  return node.children.map(plainText).join(isBlockParent(node.type) ? " " : "");
}
