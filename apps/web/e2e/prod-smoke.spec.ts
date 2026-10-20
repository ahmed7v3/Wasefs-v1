import { expect, test } from "@playwright/test";

/*
 * Read-only smoke of the live site (run with PROD_SMOKE_BASE_URL, project `prod-smoke`). Fails on
 * console errors, uncaught page errors, CSP violations and hydration warnings. No form is submitted.
 */
const PATHS = ["/", "/pricing", "/contact", "/register", "/en"];
const HYDRATION = /hydration|#418/i;

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

for (const path of PATHS) {
  test(`no console, CSP or hydration problems on ${path}`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error") problems.push(`console.error: ${text}`);
      else if (HYDRATION.test(text)) problems.push(`hydration: ${text}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response?.ok(), `${path} responded ${response?.status()}`).toBe(true);

    const violations = await page.evaluate(() => window.__cspViolations ?? []);
    for (const violation of violations) problems.push(`securitypolicyviolation: ${violation}`);
    expect(problems).toEqual([]);
  });
}
