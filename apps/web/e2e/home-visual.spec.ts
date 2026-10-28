import { expect, test, type Page } from "@playwright/test";

/*
 * Visual regression of the refreshed homepage (BRAND-AND-HOMEPAGE §3.1-§3.3, §4): the hero and the
 * precision section of `/` and `/en` at seven widths, with scroll motion on and reduced. Besides the
 * baselines it asserts what a screenshot cannot say: no horizontal overflow, the two headline lines
 * never overlap, the mobile order, and which precision layout is shown. The page needs only the web
 * app (public settings fall back to their defaults when the API is down), but it runs in the stack
 * with the other specs; baselines live in `home-visual.spec.ts-snapshots/`.
 */

const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1440] as const;
const PAGES = [
  { name: "ar", path: "/" },
  { name: "en", path: "/en" },
] as const;
const MOTION = [
  { name: "motion", reducedMotion: "no-preference" },
  { name: "reduced", reducedMotion: "reduce" },
] as const;

/** Some pixels of anti-aliasing and font-hinting difference between machines are fine. */
const SHOT = { animations: "disabled", maxDiffPixelRatio: 0.02 } as const;

async function open(
  page: Page,
  path: string,
  width: number,
  reducedMotion: "no-preference" | "reduce",
): Promise<void> {
  await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
  await page.emulateMedia({ reducedMotion });
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  // The site header has its own spec; its width must not shift the sections measured here.
  await page.evaluate(() => document.querySelector("body > header, header")?.remove());
  // The pill sweep and the scene intro are finite; let them end before measuring.
  await page.waitForTimeout(reducedMotion === "reduce" ? 100 : 3_000);
}

for (const { name: pageName, path } of PAGES) {
  for (const { name: motionName, reducedMotion } of MOTION) {
    for (const width of WIDTHS) {
      test(`home ${pageName} ${motionName} ${width}px`, async ({ page }) => {
        await open(page, path, width, reducedMotion);

        // The page content (`main`) must fit the viewport; the site header has its own checks.
        const overflowing = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          return [...document.querySelectorAll("main *")]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return (
                box.width > 0 &&
                (box.right > width + 1 || box.left < -1)
              );
            })
            .map((el) => `${el.tagName}.${String(el.getAttribute("class")).slice(0, 50)}`);
        });
        expect(overflowing, "elements wider than the viewport").toEqual([]);

        const lines = page.locator("#hero-title > span");
        await expect(lines).toHaveCount(2);
        const first = await lines.nth(0).boundingBox();
        const second = await lines.nth(1).boundingBox();
        expect(first && second).toBeTruthy();
        if (first && second) {
          expect(first.y + first.height, "headline lines overlap").toBeLessThanOrEqual(second.y);
        }

        // Pixel baselines depend on the machine's fonts and renderer, so they are compared only on
        // request (`VISUAL=1 pnpm exec playwright test home-visual --update-snapshots` writes them
        // locally, uncommitted); the layout assertions above run everywhere.
        if (!process.env.VISUAL) return;
        const key = `${pageName}-${motionName}-${width}`;
        await expect(page.locator('section[aria-labelledby="hero-title"]')).toHaveScreenshot(
          `hero-${key}.png`,
          SHOT,
        );
        await expect(page.locator("#precision")).toHaveScreenshot(`precision-${key}.png`, SHOT);
        await expect(page.locator("#whatsapp")).toHaveScreenshot(`whatsapp-${key}.png`, SHOT);
      });
    }
  }
}

test("hero on a phone: pill, headline, lead, full-width action, chips, illustration", async ({
  page,
}) => {
  await open(page, "/", 320, "no-preference");
  const top = async (selector: string): Promise<number> => {
    const box = await page
      .locator(`#main section[aria-labelledby="hero-title"] ${selector}`)
      .first()
      .boundingBox();
    expect(box, selector).toBeTruthy();
    return box?.y ?? -1;
  };
  const order = [
    await top(".hero-pill"),
    await top("#hero-title"),
    await top("#hero-title ~ p"),
    await top('a[href="/register"]'),
    await top("#hero-title ~ ul"),
    await top(".hero-scene"),
  ];
  expect(order).toEqual([...order].sort((a, b) => a - b));

  const cta = await page
    .locator('#main section[aria-labelledby="hero-title"] a[href="/register"]')
    .boundingBox();
  const container = await page.locator('section[aria-labelledby="hero-title"] > div').boundingBox();
  expect(cta && container).toBeTruthy();
  if (cta && container) {
    expect(cta.height).toBeGreaterThanOrEqual(48);
    expect(cta.width).toBeGreaterThan(container.width - 40);
  }
});

test("hero illustration keeps a fixed box while the chat plays in", async ({ page }) => {
  await open(page, "/", 390, "no-preference");
  const scene = page.locator(".hero-scene");
  const before = await scene.boundingBox();
  await page.waitForTimeout(1_500);
  const after = await scene.boundingBox();
  expect(before?.height).toBeCloseTo(after?.height ?? -1, 0);
  // The only meaningful image of the scene is its one labelled role.
  await expect(page.locator('.hero-scene[role="img"]')).toHaveCount(1);
});

test("journey section: a horizontal stepper on desktop, a vertical one on a phone", async ({
  page,
}) => {
  await open(page, "/", 1440, "no-preference");
  const rows = await page.locator("#precision ol > li").evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  );
  expect(rows).toHaveLength(4);
  expect(new Set(rows).size, "all four stages share one row").toBe(1);

  await open(page, "/", 390, "no-preference");
  const stack = await page.locator("#precision ol > li").evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  );
  expect(stack).toEqual([...stack].sort((a, b) => a - b));
  expect(new Set(stack).size, "four stages stacked").toBe(4);
});
