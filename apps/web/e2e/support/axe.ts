import AxeBuilder from "@axe-core/playwright";

import { expect } from "./fixtures";

import type { Page } from "@playwright/test";

/** WCAG 2.2 AA plus the A levels it builds on (docs: DESIGN-SYSTEM accessibility). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Waits until the page has settled, then fails on any serious or critical axe violation. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
  // A run that checked nothing would pass vacuously.
  expect(results.passes.length, `axe ran on ${label}`).toBeGreaterThan(0);
  expect(blocking, `axe violations on ${label}`).toEqual([]);
}
