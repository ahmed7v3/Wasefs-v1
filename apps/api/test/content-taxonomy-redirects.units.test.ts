import { describe, expect, it } from "vitest";

import {
  planAutoRedirect,
  planRedirect,
  toRedirectMap,
  traceRedirect,
  type RedirectEdge,
} from "../src/content/taxonomy/redirect-rules.js";

const edge = (id: string, fromPath: string, toPath: string): RedirectEdge => ({
  id,
  fromPath,
  toPath,
});

describe("traceRedirect", () => {
  it("reports a path that is not redirected", () => {
    expect(traceRedirect("/a", new Map())).toEqual({ finalPath: null, chain: [], loop: false });
  });

  it("follows a chain to its end", () => {
    const map = toRedirectMap([edge("1", "/a", "/b"), edge("2", "/b", "/c")]);
    expect(traceRedirect("/a", map)).toEqual({ finalPath: "/c", chain: ["/b", "/c"], loop: false });
  });

  it("detects a cycle", () => {
    const map = toRedirectMap([edge("1", "/a", "/b"), edge("2", "/b", "/a")]);
    expect(traceRedirect("/a", map)).toMatchObject({ finalPath: null, loop: true });
  });

  it("gives up after ten hops", () => {
    const edges = Array.from({ length: 12 }, (_, i) => edge(String(i), `/p${i}`, `/p${i + 1}`));
    const trace = traceRedirect("/p0", toRedirectMap(edges));
    expect(trace.loop).toBe(true);
    expect(trace.chain).toHaveLength(10);
    // Exactly ten hops that end on a plain path still resolve.
    const ten = traceRedirect("/p0", toRedirectMap(edges.slice(0, 10)));
    expect(ten).toMatchObject({ finalPath: "/p10", loop: false });
  });
});

describe("planRedirect", () => {
  const existing = [edge("1", "/old", "/mid"), edge("2", "/x", "/y")];

  it.each([
    ["itself", "/a", "/a", "self"],
    ["a source that already redirects", "/old", "/z", "duplicate_source"],
    ["a target that is itself redirected", "/new", "/old", "target_is_source"],
  ])("refuses %s", (_name, fromPath, toPath, issue) => {
    expect(planRedirect({ fromPath, toPath, existing })).toEqual({ ok: false, issue });
  });

  it("accepts an unrelated redirect without collapsing anything", () => {
    expect(planRedirect({ fromPath: "/n", toPath: "/m", existing })).toEqual({
      ok: true,
      repoint: [],
    });
  });

  it("collapses redirects that pointed at the new source", () => {
    expect(planRedirect({ fromPath: "/mid", toPath: "/final", existing })).toEqual({
      ok: true,
      repoint: ["1"],
    });
  });

  it("refuses a collapse that would make a redirect point at itself", () => {
    // /a -> /b exists; adding /b -> /a would loop.
    expect(
      planRedirect({ fromPath: "/b", toPath: "/a", existing: [edge("1", "/a", "/b")] }),
    ).toEqual({ ok: false, issue: "target_is_source" });
    // Same via a pointing edge whose source equals the new target but is not a registered source twice.
    expect(
      planRedirect({
        fromPath: "/b",
        toPath: "/c",
        existing: [edge("1", "/c", "/b")],
      }),
    ).toEqual({ ok: false, issue: "target_is_source" });
  });
});

describe("planAutoRedirect", () => {
  it("writes a plain redirect", () => {
    expect(planAutoRedirect({ fromPath: "/old", toPath: "/new", existing: [] })).toEqual({
      remove: [],
      repoint: [],
      edge: { fromPath: "/old", toPath: "/new" },
    });
  });

  it("drops a redirect from the target (it is live) and repoints earlier redirects", () => {
    const plan = planAutoRedirect({
      fromPath: "/b",
      toPath: "/c",
      existing: [edge("1", "/a", "/b"), edge("2", "/c", "/d")],
    });
    expect(plan.remove).toEqual(["2"]);
    expect(plan.edge).toEqual({ fromPath: "/b", toPath: "/c" });
    expect(plan.repoint).toEqual(["1"]);
  });

  it("removes a redirect that would shadow the path that is live again", () => {
    // /a was renamed to /b earlier; renaming back makes /a live: delete /a -> /b, write nothing.
    const plan = planAutoRedirect({
      fromPath: "/b",
      toPath: "/a",
      existing: [edge("1", "/a", "/b")],
    });
    expect(plan.remove).toEqual(["1"]);
    expect(plan.edge).toEqual({ fromPath: "/b", toPath: "/a" });
  });

  it("never leaves a cycle when paths are swapped back", () => {
    const plan = planAutoRedirect({
      fromPath: "/a",
      toPath: "/b",
      existing: [edge("1", "/b", "/c"), edge("2", "/c", "/a")],
    });
    expect(plan.remove).toEqual(["1"]);
    expect(plan.edge).toEqual({ fromPath: "/a", toPath: "/b" });
    expect(plan.repoint).toEqual(["2"]);
  });
});
