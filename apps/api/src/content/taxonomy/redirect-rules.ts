/*
 * Redirect integrity (CONTENT-PLATFORM section 7): a redirect never loops and never chains. Pure
 * functions over the set of existing edges so the unit test covers the table of cases.
 */

export interface RedirectEdge {
  id: string;
  fromPath: string;
  toPath: string;
}

export const MAX_REDIRECT_HOPS = 10;

export interface RedirectTrace {
  /** Where the request ends up; null when the path is not redirected or the chain does not resolve. */
  finalPath: string | null;
  /** Every destination in order (more than one = a chain to fix). Empty when not redirected. */
  chain: string[];
  /** A cycle, or more than `MAX_REDIRECT_HOPS` hops (treated as unresolvable). */
  loop: boolean;
}

/** Follows `path` through the redirect map the way a visitor's browser would. */
export function traceRedirect(
  path: string,
  map: ReadonlyMap<string, string>,
  maxHops = MAX_REDIRECT_HOPS,
): RedirectTrace {
  const seen = new Set<string>([path]);
  const chain: string[] = [];
  let current = path;
  for (let hop = 0; hop < maxHops; hop++) {
    const next = map.get(current);
    if (next === undefined) return { finalPath: chain.at(-1) ?? null, chain, loop: false };
    chain.push(next);
    if (seen.has(next)) return { finalPath: null, chain, loop: true };
    seen.add(next);
    current = next;
  }
  // Out of hops: resolved only if the last destination is not itself redirected.
  const resolved = !map.has(current);
  return { finalPath: resolved ? current : null, chain, loop: !resolved };
}

export function toRedirectMap(edges: readonly RedirectEdge[]): Map<string, string> {
  return new Map(edges.map((edge) => [edge.fromPath, edge.toPath]));
}

export type RedirectIssue = "self" | "duplicate_source" | "target_is_source" | "loop";

export type RedirectPlan = { ok: true; repoint: string[] } | { ok: false; issue: RedirectIssue };

/**
 * Verdict for a manual redirect `fromPath -> toPath`. `existing` are the other edges (the edited one
 * excluded by the caller). Edges already pointing at the new source are collapsed: they are repointed
 * to the new target, unless that would make one of them point at itself (a loop).
 */
export function planRedirect(input: {
  fromPath: string;
  toPath: string;
  existing: readonly RedirectEdge[];
}): RedirectPlan {
  const { fromPath, toPath, existing } = input;
  if (fromPath === toPath) return { ok: false, issue: "self" };
  if (existing.some((edge) => edge.fromPath === fromPath)) {
    return { ok: false, issue: "duplicate_source" };
  }
  if (existing.some((edge) => edge.fromPath === toPath)) {
    return { ok: false, issue: "target_is_source" };
  }
  const pointing = existing.filter((edge) => edge.toPath === fromPath);
  if (pointing.some((edge) => edge.fromPath === toPath)) return { ok: false, issue: "loop" };
  return { ok: true, repoint: pointing.map((edge) => edge.id) };
}

export interface AutoRedirectPlan {
  /** Redirects whose source is the path that is now live again: deleted (they would shadow it). */
  remove: string[];
  /** Existing redirects that pointed at the old path: now point at `edge.toPath`. */
  repoint: string[];
  /** The redirect to write (insert or update by source); null when none is needed. */
  edge: { fromPath: string; toPath: string } | null;
}

/**
 * Redirects written by the system (a slug rename, a tag merge). Unlike a manual one it never throws:
 * it resolves the target to its final destination, removes redirects that would shadow a live path,
 * and skips a redirect that would loop.
 */
export function planAutoRedirect(input: {
  fromPath: string;
  toPath: string;
  existing: readonly RedirectEdge[];
}): AutoRedirectPlan {
  const remove = input.existing.filter((edge) => edge.fromPath === input.toPath).map((e) => e.id);
  const kept = input.existing.filter((edge) => !remove.includes(edge.id));
  const trace = traceRedirect(input.toPath, toRedirectMap(kept));
  if (trace.loop) return { remove, repoint: [], edge: null };
  const finalPath = trace.finalPath ?? input.toPath;
  if (finalPath === input.fromPath) return { remove, repoint: [], edge: null };
  const repoint = kept
    .filter((edge) => edge.toPath === input.fromPath && edge.fromPath !== finalPath)
    .map((edge) => edge.id);
  // An edge that would now point at itself is dropped instead of repointed.
  const selfLoop = kept
    .filter((edge) => edge.toPath === input.fromPath && edge.fromPath === finalPath)
    .map((edge) => edge.id);
  return {
    remove: [...remove, ...selfLoop],
    repoint,
    edge: { fromPath: input.fromPath, toPath: finalPath },
  };
}
