import { expectAccessible } from "./support/axe";
import { expect, test } from "./support/fixtures";

/*
 * The home page in the early-access look (openspec home-ads-conversion, home-page): no horizontal
 * scroll from a 320 px phone to a wide desktop, touch targets of 44 px, the signed-out entry points,
 * and no serious accessibility violation. Needs only the web app (public settings fall back to
 * their defaults when the API is down), but runs with the stack like the other specs.
 */

const WIDTHS = [320, 768, 1440] as const;

for (const width of WIDTHS) {
  test(`home fits ${width}px without horizontal scroll and has 44px hero buttons`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

    const hero = page.locator('section[aria-labelledby="hero-title"]');
    const buttons = hero.locator("a[href='/register'], a[href='/login']");
    await expect(buttons).toHaveCount(2);
    for (const box of await buttons.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    )) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });
}

test("a signed-out visitor starts free at /register and signs in at /login", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator('section[aria-labelledby="hero-title"]');
  await expect(hero.locator("a[href='/register']")).toBeVisible();
  await expect(hero.locator("a[href='/login']")).toBeVisible();
  await expect(hero.locator("a[href='/dashboard']")).toHaveCount(0);
});

test("home has no serious accessibility violation, in Arabic and English", async ({ page }) => {
  await page.goto("/");
  await expectAccessible(page, "home (ar)");
  await page.goto("/en");
  await expectAccessible(page, "home (en)");
});
