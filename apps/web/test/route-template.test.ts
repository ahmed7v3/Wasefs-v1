import { routeTemplateSchema } from "@wasfa/shared/schemas/public-site";
import { describe, expect, it } from "vitest";

import { botRoute, vitalsRoute } from "../src/lib/route-template";
import { rateVital, vitalValue } from "../src/lib/site-health";

describe("vitalsRoute", () => {
  it("maps the public pages (Arabic and English paths) to themselves", () => {
    expect(vitalsRoute("/")).toBe("/");
    expect(vitalsRoute("/en")).toBe("/en");
    expect(vitalsRoute("/pricing")).toBe("/pricing");
    expect(vitalsRoute("/en/contact")).toBe("/en/contact");
  });

  it("ignores the query, a trailing slash and case", () => {
    expect(vitalsRoute("/pricing/?ref=ABC123&utm_source=x")).toBe("/pricing");
    expect(vitalsRoute("/Contact")).toBe("/contact");
  });

  it("sends everything else to /other", () => {
    expect(vitalsRoute("/blog/post-1")).toBe("/other");
    expect(vitalsRoute("/en/unknown")).toBe("/other");
  });
});

describe("botRoute", () => {
  it("keeps known pages and groups unknown trees by their first segment", () => {
    expect(botRoute("/privacy")).toBe("/privacy");
    expect(botRoute("/blog/a-post")).toBe("/blog/[rest]");
    expect(botRoute("/blog/a/b/c")).toBe("/blog/[rest]");
    expect(botRoute("/en/guides/x")).toBe("/en/[rest]");
  });

  it("falls back to /other for single unknown segments and odd paths", () => {
    expect(botRoute("/wp-login")).toBe("/other");
    expect(botRoute("/%E0%A4%A/x")).toBe("/other");
  });

  it("always produces something the API accepts", () => {
    for (const path of ["/", "/en", "/pricing", "/blog/x", "/x", "/a b/c", "/%00/x"]) {
      expect(routeTemplateSchema.safeParse(botRoute(path)).success, path).toBe(true);
      expect(routeTemplateSchema.safeParse(vitalsRoute(path)).success, path).toBe(true);
    }
  });
});

describe("rateVital", () => {
  it("rates the p75 bucket bound against the Core Web Vitals thresholds", () => {
    expect(rateVital("LCP", 2500)).toBe("good");
    expect(rateVital("LCP", 3000)).toBe("needsImprovement");
    expect(rateVital("LCP", 6000)).toBe("poor");
    expect(rateVital("INP", 200)).toBe("good");
    expect(rateVital("INP", 300)).toBe("needsImprovement");
    expect(rateVital("CLS", 100)).toBe("good");
    expect(rateVital("CLS", 250)).toBe("needsImprovement");
    expect(rateVital("CLS", 400)).toBe("poor");
    expect(rateVital("TTFB", 1800)).toBe("needsImprovement");
    expect(rateVital("FCP", null)).toBe("poor");
  });

  it("shows CLS as a score and the rest in milliseconds", () => {
    expect(vitalValue("CLS", 100)).toBe("0.1");
    expect(vitalValue("LCP", 2500)).toBe("2500 ms");
  });
});
