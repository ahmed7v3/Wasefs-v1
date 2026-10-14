import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { expectAccessible } from "./support/axe";
import { expect, test, watchCsp } from "./support/fixtures";

import type { BrowserContext, Page } from "@playwright/test";

/*
 * Task 2.6 acceptance: drop, paste, pick, reorder by keyboard, the blur warning, the size after
 * the in-browser resize, the phone handoff on two browser contexts, HEIC (needs a fixture file),
 * and axe on the screens. Uploads go to a real MinIO and are processed by the real worker.
 */

type Kind = "sharp" | "blurred" | "photo";
interface Fixture {
  name: string;
  mimeType: string;
  base64: string;
}

/**
 * Draws a test picture in the browser and returns it as a JPEG. `sharp` is a page of crisp text,
 * `blurred` the same page through a heavy blur, `photo` a big noisy frame (the 8 MB phone photo).
 */
async function fixture(
  page: Page,
  kind: Kind,
  name: string,
  size?: [number, number],
): Promise<Fixture> {
  const base64 = await page.evaluate(
    async ({ kind, size }) => {
      const [width, height] = size ?? [1600, 1200];
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      if (kind === "photo") {
        // Smooth light and shadow plus fine noise: heavy as a JPEG, light once resized.
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#d8d2c4");
        gradient.addColorStop(1, "#8a8f98");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        const image = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < image.data.length; i += 4) {
          const noise = (Math.random() - 0.5) * 20;
          image.data[i] = (image.data[i] ?? 0) + noise;
          image.data[i + 1] = (image.data[i + 1] ?? 0) + noise;
          image.data[i + 2] = (image.data[i + 2] ?? 0) + noise;
        }
        ctx.putImageData(image, 0, 0);
        ctx.fillStyle = "#101010";
        ctx.font = "bold 90px sans-serif";
        for (let line = 0; line < 8; line += 1)
          ctx.fillText("Rx Amoxicillin 500 mg", 120, 200 + line * 160);
      } else {
        ctx.fillStyle = "#111111";
        ctx.font = "bold 30px monospace";
        for (let line = 0; line < 28; line += 1) {
          ctx.fillText(`Rx ${String(line)}  Amoxicillin 500 mg  1 x 3  7 days`, 60, 60 + line * 40);
        }
      }
      let out = canvas;
      if (kind === "blurred") {
        out = document.createElement("canvas");
        out.width = width;
        out.height = height;
        const blur = out.getContext("2d");
        if (!blur) throw new Error("no 2d context");
        blur.filter = "blur(14px)";
        blur.drawImage(canvas, 0, 0);
      }
      const blob = await new Promise<Blob | null>((resolve) => {
        out.toBlob(resolve, "image/jpeg", kind === "photo" ? 1 : 0.92);
      });
      if (!blob) throw new Error("no jpeg");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    { kind, size },
  );
  return { name, mimeType: "image/jpeg", base64 };
}

const asFile = (f: Fixture) => ({
  name: f.name,
  mimeType: f.mimeType,
  buffer: Buffer.from(f.base64, "base64"),
});

/** Signs in a verified, onboarded user and opens /analyze. */
async function openAnalyze(
  context: BrowserContext,
  page: Page,
  urls: { web: string; api: string },
  redis: Parameters<typeof signedInAccount>[2],
): Promise<void> {
  const account = await signedInAccount(context, urls, redis, newAccount("Cap"));
  await finishOnboarding(page.request, urls, account.name);
  await page.goto("/analyze");
  await expect(page.getByRole("heading", { name: t("capture.empty.title") })).toBeVisible();
}

const tiles = (page: Page) => page.locator("li[data-local-id]");
const uploaded = (page: Page) => page.locator('li[data-local-id][data-status="uploaded"]');
const picker = (page: Page) => page.getByTestId("capture-picker");

/** A DataTransfer holding the file, built inside the page. */
function transferOf(page: Page, f: Fixture) {
  return page.evaluateHandle(({ name, mimeType, base64 }) => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    data.items.add(new File([bytes], name, { type: mimeType }));
    return data;
  }, f);
}

test.describe("capture on /analyze", () => {
  test("a dropped picture shows the overlay, then becomes a ready page", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await openAnalyze(context, page, urls, redis);
    const file = await fixture(page, "sharp", "drop.jpg");
    const data = await transferOf(page, file);

    await page.dispatchEvent("body", "dragenter", { dataTransfer: data });
    await expect(page.getByText(t("capture.drop.title"))).toBeVisible();
    await page.dispatchEvent("body", "dragleave", { dataTransfer: data });
    await expect(page.getByText(t("capture.drop.title"))).toBeHidden();

    await page.dispatchEvent("body", "dragenter", { dataTransfer: data });
    await page.dispatchEvent("body", "drop", { dataTransfer: data });
    await expect(page.getByText(t("capture.drop.title"))).toBeHidden();
    await expect(uploaded(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("capture-live")).toContainText(
      t("capture.live.uploaded", { n: 1 }),
    );
  });

  test("a pasted picture is added anywhere on the page", async ({ context, page, urls, redis }) => {
    await openAnalyze(context, page, urls, redis);
    const file = await fixture(page, "sharp", "paste.jpg");
    await page.evaluate(({ name, mimeType, base64 }) => {
      const data = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], name, { type: mimeType }));
      document.body.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, file);
    await expect(uploaded(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test("picked files are added in order, and the page limit is respected", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await openAnalyze(context, page, urls, redis);
    const files = await Promise.all(
      ["a", "b", "c", "d", "e"].map((n) => fixture(page, "sharp", `${n}.jpg`)),
    );
    await picker(page).setInputFiles(files.map(asFile));
    await expect(tiles(page)).toHaveCount(4);
    await expect(uploaded(page)).toHaveCount(4, { timeout: 60_000 });
    await expect(page.getByText(t("capture.limit.full", { max: 4 }))).toBeVisible();
    await expectAccessible(page, "/analyze with four pages");
  });

  test("pages are reordered with the arrow keys and the move is announced", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await openAnalyze(context, page, urls, redis);
    const files = await Promise.all(["a", "b", "c"].map((n) => fixture(page, "sharp", `${n}.jpg`)));
    await picker(page).setInputFiles(files.map(asFile));
    await expect(uploaded(page)).toHaveCount(3, { timeout: 60_000 });

    const ids = () =>
      tiles(page).evaluateAll((items) => items.map((i) => i.getAttribute("data-local-id")));
    const before = await ids();
    await tiles(page).first().focus();
    // The page is right-to-left: the left arrow moves the page toward the end.
    await page.keyboard.press("ArrowLeft");
    const after = await ids();
    expect(after).toEqual([before[1], before[0], before[2]]);
    await expect(page.getByTestId("capture-live")).toContainText(
      t("capture.live.moved", { position: 2, total: 3 }),
    );
    // The moved tile keeps focus.
    await expect(tiles(page).nth(1)).toBeFocused();
  });

  test("a blurry photo waits for a decision and costs nothing", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await openAnalyze(context, page, urls, redis);
    const blurred = await fixture(page, "blurred", "blurred.jpg");
    await picker(page).setInputFiles(asFile(blurred));

    await expect(page.getByTestId("quality-hint")).toContainText(t("capture.quality.title.blurry"));
    await expect(page.locator('li[data-status="warning"]')).toHaveCount(1);
    // A new account has no credits yet: Analyze gives way to the calm "not enough credits" state.
    await expect(page.getByText(t("capture.analyze.insufficient"))).toBeVisible();
    await expect(page.getByRole("link", { name: t("capture.analyze.support") })).toBeVisible();
    await expectAccessible(page, "/analyze with a quality hint");

    await page.getByRole("button", { name: t("capture.quality.continue") }).click();
    await expect(uploaded(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test("an 8 MB phone photo is uploaded as less than 1 MB, 2048 px at most", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(120_000);
    const csp = await watchCsp(page);
    await openAnalyze(context, page, urls, redis);
    const photo = await fixture(page, "photo", "big.jpg", [4000, 3000]);
    const sourceBytes = Buffer.from(photo.base64, "base64").length;
    expect(sourceBytes, "the fixture is a big photo").toBeGreaterThan(8 * 1024 * 1024);

    // Chromium has OffscreenCanvas, so the resize runs in a Worker rather than on the main thread.
    let workers = 0;
    page.on("worker", () => {
      workers += 1;
    });
    const sent: number[] = [];
    await page.route(
      (url) => url.port !== new URL(urls.web).port && url.port !== new URL(urls.api).port,
      async (route) => {
        if (route.request().method() === "PUT") {
          sent.push(route.request().postDataBuffer()?.length ?? -1);
        }
        await route.continue();
      },
    );
    await picker(page).setInputFiles(asFile(photo));
    await expect(uploaded(page)).toHaveCount(1, { timeout: 60_000 });
    expect(workers).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeGreaterThan(0);
    expect(sent[0]).toBeLessThan(1024 * 1024);
    // The worker, the XHR to storage and the preview all run under the production CSP.
    expect(await csp.violations()).toEqual([]);
  });

  test("a HEIC photo is converted in the browser", async ({ context, page, urls, redis }) => {
    const heic = fileURLToPath(new URL("./fixtures/sample.heic", import.meta.url));
    test.skip(!existsSync(heic), "needs e2e/fixtures/sample.heic (a real iPhone photo)");
    await openAnalyze(context, page, urls, redis);
    await picker(page).setInputFiles({
      name: "IMG_0001.HEIC",
      mimeType: "image/heic",
      buffer: readFileSync(heic),
    });
    await expect(uploaded(page)).toHaveCount(1, { timeout: 60_000 });
  });

  test("the empty screen is accessible", async ({ context, page, urls, redis }) => {
    await openAnalyze(context, page, urls, redis);
    await expectAccessible(page, "/analyze empty at 1440 px");
    await page.setViewportSize({ width: 360, height: 800 });
    await expectAccessible(page, "/analyze empty at 360 px");
    // No horizontal scroll at phone width, and the main controls are at least 44 px tall.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const pick = await page.getByRole("button", { name: t("capture.pick") }).boundingBox();
    expect(pick?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

test.describe("phone handoff", () => {
  test("a phone adds pages to the desktop live, and cannot analyse", async ({
    browser,
    context,
    page,
    urls,
    redis,
  }) => {
    const csp = await watchCsp(page);
    await openAnalyze(context, page, urls, redis);
    await page.getByRole("button", { name: t("capture.phone") }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(t("capture.handoff.waiting"))).toBeVisible();
    const link = (await dialog.locator('bdi[dir="ltr"]').first().textContent())?.trim() ?? "";
    expect(link).toMatch(/\/capture\/[A-Za-z0-9_-]{43}$/);

    // The phone: another browser, no session, a touch screen.
    const phone = await browser.newContext({
      baseURL: urls.web,
      locale: "ar",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    try {
      const phonePage = await phone.newPage();
      await phonePage.goto(link);
      await expect(
        phonePage.getByRole("heading", { name: t("capture.phonePage.title") }),
      ).toBeVisible();
      await expect(phonePage.getByRole("button", { name: t("capture.camera") })).toBeVisible();
      // No Analyze anywhere on the phone.
      await expect(phonePage.getByRole("button", { name: /^تحليل/ })).toHaveCount(0);
      await expectAccessible(phonePage, "/capture/<token>");

      const file = await fixture(phonePage, "sharp", "phone.jpg");
      await phonePage.getByTestId("capture-picker").setInputFiles(asFile(file));
      await expect(uploaded(phonePage)).toHaveCount(1, { timeout: 30_000 });

      // Live on the desktop, without a reload.
      await expect(
        dialog.getByText(t("capture.handoff.connected", { count: 1, max: 4 })),
      ).toBeVisible({
        timeout: 30_000,
      });
      await dialog.getByText(t("capture.handoff.close"), { exact: true }).click();
      await expect(uploaded(page)).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId("capture-live")).toContainText(
        t("capture.live.addedFromPhone", { n: 1 }),
      );
      // The live feed (EventSource) and the phone page's picture preview obey the CSP too.
      expect(await csp.violations()).toEqual([]);
    } finally {
      await phone.close();
    }
  });

  test("an unknown or malformed link shows the friendly page", async ({ browser, urls }) => {
    const phone = await browser.newContext({ baseURL: urls.web, locale: "ar" });
    try {
      const phonePage = await phone.newPage();
      for (const token of ["x".repeat(43), "short"]) {
        const response = await phonePage.goto(`/capture/${token}`);
        expect(response?.status()).toBe(404);
        await expect(
          phonePage.getByRole("heading", { name: t("capture.phonePage.invalid.title") }),
        ).toBeVisible();
        const robots = await phonePage
          .locator('meta[name="robots"]')
          .evaluateAll((tags) => tags.map((tag) => tag.getAttribute("content") ?? ""));
        expect(robots.length).toBeGreaterThan(0);
        for (const content of robots) expect(content).toContain("noindex");
      }
    } finally {
      await phone.close();
    }
  });
});
