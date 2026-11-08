import { DEFAULT_LANDING_SECTIONS, LANDING_SECTION_KEYS } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { visibleLandingSections } from "../src/lib/landing-sections";

describe("visibleLandingSections", () => {
  it("renders every section in the current order by default", () => {
    expect(visibleLandingSections(DEFAULT_LANDING_SECTIONS)).toEqual([...LANDING_SECTION_KEYS]);
  });

  it("drops a disabled section", () => {
    const sections = DEFAULT_LANDING_SECTIONS.map((section) =>
      section.key === "audiences" ? { ...section, enabled: false } : section,
    );
    expect(visibleLandingSections(sections)).not.toContain("audiences");
    expect(visibleLandingSections(sections)).toHaveLength(LANDING_SECTION_KEYS.length - 1);
  });

  it("follows the stored order and keeps unlisted sections after it", () => {
    const result = visibleLandingSections([
      { key: "faq", enabled: true, order: 1 },
      { key: "whatsapp", enabled: true, order: 2 },
    ]);
    expect(result.slice(0, 2)).toEqual(["faq", "whatsapp"]);
    expect(result).toHaveLength(LANDING_SECTION_KEYS.length);
  });

  it("ignores a repeated key after its first entry", () => {
    const result = visibleLandingSections([
      { key: "faq", enabled: false, order: 1 },
      { key: "faq", enabled: true, order: 2 },
    ]);
    expect(result).not.toContain("faq");
  });
});
