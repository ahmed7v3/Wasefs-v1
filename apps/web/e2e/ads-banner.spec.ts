import { signedInSuperAdmin } from "./support/admin-billing";
import { expect, test } from "./support/fixtures";

import type { Page } from "@playwright/test";

// openspec home-ads-conversion 3.4: the closable bottom banner. It closes with one tap and stays closed
// on that device, it covers no content (a spacer of equal height), and it never appears on checkout,
// pricing or result pages. WRITTEN BUT NOT EXECUTED in the sandbox that produced it (no Docker, so no
// stack): run it with the rest of the e2e suite. The API caches slots for up to 60 s, so the spec polls
// with reloads instead of expecting the banner on the first load after seeding.

const unique = () => Math.random().toString(36).slice(2, 8);

async function patch(page: Page, api: string, web: string, path: string, data: object) {
  const response = await page.request.fetch(`${api}${path}`, {
    method: "PATCH",
    data,
    headers: { Origin: web },
  });
  if (!response.ok())
    throw new Error(`${path}: ${String(response.status())} ${await response.text()}`);
  return (await response.json()) as { id?: string };
}

test("bottom banner: shows, closes, stays closed, never on conversion or result pages", async ({
  page,
  browser,
  urls,
  redis,
}) => {
  await signedInSuperAdmin(page, urls, redis);

  // Seed: ads on, the banner on for marketing pages, one approved house creative.
  await patch(page, urls.api, urls.web, "/admin/ads/settings", { enabled: true });
  await patch(page, urls.api, urls.web, "/admin/ads/placements/global.bottom_banner", {
    enabled: true,
    pageClasses: ["marketing"],
    dismissDays: 7,
  });
  const created = await page.request.fetch(`${urls.api}/admin/ads/creatives`, {
    method: "POST",
    data: {
      title: `Banner ${unique()}`,
      alt: "Banner",
      targetUrl: "https://example.com/offer",
      category: "house",
      targeting: { placements: ["global.bottom_banner"] },
    },
    headers: { Origin: urls.web },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const approved = await page.request.fetch(`${urls.api}/admin/ads/creatives/${id}/status`, {
    method: "POST",
    data: { status: "approved" },
    headers: { Origin: urls.web },
  });
  expect(approved.ok()).toBe(true);

  // A visitor, with no admin session.
  const visitor = await browser.newContext({ baseURL: urls.web });
  const home = await visitor.newPage();
  const banner = home.getByTestId("bottom-banner");
  await expect(async () => {
    await home.goto("/");
    await expect(banner).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });

  // It is labelled, and a spacer of at least its height ends the page so no content is covered.
  await expect(banner).toHaveAttribute("aria-label", /إعلان/);
  const bannerHeight = (await banner.boundingBox())?.height ?? 0;
  const spacerHeight = (await home.getByTestId("bottom-banner-spacer").boundingBox())?.height ?? 0;
  expect(spacerHeight).toBeGreaterThanOrEqual(bannerHeight - 1);

  // One tap closes it; it stays closed after a reload and when the visitor opens another page.
  await home.getByRole("button", { name: /إغلاق الإعلان/ }).click();
  await expect(banner).toHaveCount(0);
  await expect(home.getByTestId("bottom-banner-spacer")).toHaveCount(0);
  expect(
    await home.evaluate(() => Number(localStorage.getItem("adBannerClosedUntil"))),
  ).toBeGreaterThan(Date.now());
  await home.reload();
  await expect(banner).toHaveCount(0);

  // Never on conversion pages, even for a visitor who never closed it.
  const fresh = await browser.newContext({ baseURL: urls.web });
  const other = await fresh.newPage();
  for (const path of ["/pricing", "/login", "/register", "/checkout"]) {
    await other.goto(path);
    await expect(other.getByTestId("bottom-banner"), path).toHaveCount(0);
  }
  await visitor.close();
  await fresh.close();
});

test("bottom banner: a signed-in user never sees it on a result or checkout page", async ({
  page,
  urls,
  redis,
}) => {
  await signedInSuperAdmin(page, urls, redis);
  for (const path of ["/checkout", "/analyze/00000000-0000-4000-8000-000000000000", "/account"]) {
    await page.goto(path);
    await expect(page.getByTestId("bottom-banner"), path).toHaveCount(0);
  }
});
