import { describe, expect, it } from "vitest";

import { SvgRejected, sanitizeSvg, svgGeometry } from "../src/branding/svg-sanitize.js";

import { MALFORMED_SVGS, MALICIOUS_SVGS } from "./support/branding-fixtures.js";

const NS = 'xmlns="http://www.w3.org/2000/svg"';

/** Nothing a browser or rasteriser could act on may survive in the output. */
const DANGEROUS =
  /<script|<foreignobject|<iframe|<image|<use|<style|<a[\s>]|<set|<animate|\son[a-z]+\s*=|javascript:|data:|https?:|@import|<!|<\?|&[a-z#]/i;

function outcome(input: string): "rejected" | string {
  try {
    return sanitizeSvg(input);
  } catch (error) {
    if (error instanceof SvgRejected) return "rejected";
    throw error;
  }
}

describe("sanitizeSvg", () => {
  it("keeps a plain symbol: shapes, gradients, local references", () => {
    const out = sanitizeSvg(
      `<?xml version="1.0"?><!-- c --><svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">` +
        `<title>Wasfa</title><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient>` +
        `<clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath></defs>` +
        `<g clip-path="url(#c)"><path d="M10 10 L90 10 L50 90 Z" fill="url(#g)" stroke="#000" stroke-width="2"/></g>` +
        `<rect x="1" y="1" width="5" height="5" rx="1" fill="#fff" opacity="0.5"/></svg>`,
    );
    expect(out).toBe(
      `<svg ${NS} viewBox="0 0 100 100"><title>Wasfa</title><defs>` +
        `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4ed8"/>` +
        `<stop offset="1" stop-color="#0ea5e9"/></linearGradient>` +
        `<clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath></defs>` +
        `<g clip-path="url(#c)"><path d="M10 10 L90 10 L50 90 Z" fill="url(#g)" stroke="#000" stroke-width="2"/></g>` +
        `<rect x="1" y="1" width="5" height="5" rx="1" fill="#fff" opacity="0.5"/></svg>`,
    );
  });

  it("is idempotent", () => {
    const once = sanitizeSvg(
      `<svg ${NS} viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>`,
    );
    expect(sanitizeSvg(once)).toBe(once);
  });

  it("rewrites xlink:href on a gradient to a plain local href", () => {
    const out = sanitizeSvg(
      `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><defs>` +
        `<linearGradient id="a"/><linearGradient id="b" xlink:href="#a"/></defs></svg>`,
    );
    expect(out).toContain('<linearGradient id="b" href="#a"/>');
    expect(out).not.toContain("xlink");
  });

  describe("the hostile corpus of the denylist path, run through the allow-list", () => {
    for (const [name, input] of Object.entries(MALICIOUS_SVGS)) {
      it(name, () => {
        const result = outcome(input);
        if (result !== "rejected") expect(result.replace(NS, "")).not.toMatch(DANGEROUS);
      });
    }
  });

  describe("malformed input", () => {
    for (const [name, input] of Object.entries(MALFORMED_SVGS)) {
      it(`refuses ${name}`, () => {
        expect(outcome(input)).toBe("rejected");
      });
    }
  });

  it("removes script, handlers, foreignObject and everything outside the allow-list", () => {
    const out = sanitizeSvg(
      `<svg ${NS} onload="alert(1)" viewBox="0 0 10 10">` +
        `<script>alert(1)</script><foreignObject><div>x</div></foreignObject>` +
        `<style>rect{fill:url(https://e.com/a)}</style><image href="https://e.com/a.png"/>` +
        `<rect width="1" height="1" onclick="x()" style="fill:red" class="a" fill="blue"/>` +
        `<animate attributeName="fill"/><use href="#x"/></svg>`,
    );
    expect(out).toBe(
      `<svg ${NS} viewBox="0 0 10 10"><rect width="1" height="1" fill="blue"/></svg>`,
    );
  });

  it("drops attributes whose value is not plain (javascript:, data:, external or quoted url())", () => {
    const out = sanitizeSvg(
      `<svg ${NS} viewBox="0 0 10 10">` +
        `<rect id="a" width="1" height="1" fill="javascript:alert(1)"/>` +
        `<rect id="b" width="1" height="1" fill="url(https://e.com/x#a)"/>` +
        `<rect id="c" width="1" height="1" fill="url('#a')"/>` +
        `<rect id="d" width="1" height="1" fill="url(data:image/svg+xml;base64,AAAA)"/>` +
        `<rect id="e" width="1" height="1" fill="url(#a) red" stroke="url(#a"/>` +
        `<rect id="f" width="1&#10;" height="1&amp;" /></svg>`,
    );
    expect(out.replace(NS, "")).not.toMatch(DANGEROUS);
    expect(out).toContain('<rect id="a" width="1" height="1"/>');
    expect(out).toContain('<rect id="b" width="1" height="1"/>');
    expect(out).toContain('<rect id="c" width="1" height="1"/>');
    expect(out).toContain('<rect id="d" width="1" height="1"/>');
    expect(out).toContain('<rect id="e" width="1" height="1" fill="url(#a) red"/>');
  });

  it("drops an href that is not a local id, and any href on a shape", () => {
    const out = sanitizeSvg(
      `<svg ${NS} viewBox="0 0 1 1"><defs><linearGradient id="a" href="https://e.com/g#a"/>` +
        `<linearGradient id="b" href="#a"/></defs><path href="#a" d="M0 0"/></svg>`,
    );
    expect(out).toContain('<linearGradient id="a"/>');
    expect(out).toContain('<linearGradient id="b" href="#a"/>');
    expect(out).toContain('<path d="M0 0"/>');
  });

  it("drops namespaced editor elements and attributes (Inkscape, Sodipodi)", () => {
    const out = sanitizeSvg(
      `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1" viewBox="0 0 1 1">` +
        `<sodipodi:namedview id="n"/><metadata><rdf:RDF/></metadata><g inkscape:label="x"><circle r="1"/></g></svg>`,
    );
    expect(out).toBe(`<svg ${NS} viewBox="0 0 1 1"><g><circle r="1"/></g></svg>`);
  });

  describe("refuses outright", () => {
    it.each([
      [
        "a DOCTYPE with an entity bomb",
        `<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg ${NS}>&b;</svg>`,
      ],
      ["an entity reference", `<svg ${NS}><title>&xxe;</title></svg>`],
      ["a stylesheet instruction", `<?xml-stylesheet href="x.css"?><svg ${NS}/>`],
      ["a processing instruction inside", `<svg ${NS}><?php echo 1 ?></svg>`],
      ["a control character reference", `<svg ${NS}><title>&#1;</title></svg>`],
      ["too many elements", `<svg ${NS}>${"<g/>".repeat(1600)}</svg>`],
      ["too deep nesting", `<svg ${NS}>${"<g>".repeat(40)}${"</g>".repeat(40)}</svg>`],
      ["a NUL byte", `<svg ${NS}>\u0000</svg>`],
    ])("%s", (_name, input) => {
      expect(outcome(input)).toBe("rejected");
    });
  });

  it("escapes text it keeps and drops text elsewhere", () => {
    const out = sanitizeSvg(
      `<svg ${NS} viewBox="0 0 1 1">loose text<title>a &lt;b&gt; &amp; c</title><g>more<![CDATA[<script>]]></g></svg>`,
    );
    expect(out).toBe(`<svg ${NS} viewBox="0 0 1 1"><title>a &lt;b&gt; &amp; c</title><g/></svg>`);
  });
});

describe("svgGeometry", () => {
  it("reads the viewBox first, then plain width and height", () => {
    expect(svgGeometry(`<svg ${NS} viewBox="0 0 24 24" width="100"></svg>`)).toEqual({
      width: 24,
      height: 24,
    });
    expect(svgGeometry(`<svg ${NS} width="64px" height="32"></svg>`)).toEqual({
      width: 64,
      height: 32,
    });
    expect(svgGeometry(`<svg ${NS}></svg>`)).toEqual({ width: null, height: null });
    expect(svgGeometry(`<svg ${NS} viewBox="0 0 0 5"></svg>`)).toEqual({
      width: null,
      height: null,
    });
  });
});
