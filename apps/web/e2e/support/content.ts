import { createHash } from "node:crypto";

import { adminGet } from "./admin-billing";
import { expect } from "./fixtures";

import type { StackUrls } from "./runtime";
import type { Page } from "@playwright/test";

/** JSON call to the admin API with the page's session (the API checks the Origin header). */
export async function sendJson<T>(
  page: Page,
  urls: StackUrls,
  method: "POST" | "PATCH",
  path: string,
  data: object,
): Promise<T> {
  const response = await page.request.fetch(`${urls.api}${path}`, {
    method,
    data,
    headers: { Origin: urls.web },
  });
  if (!response.ok()) {
    throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** A 1x1 PNG: the smallest image the media pipeline accepts. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Uploads the PNG through the API, waits for the worker to process it and gives it an Arabic alt text. */
export async function createReadyMedia(page: Page, urls: StackUrls): Promise<string> {
  const upload = await sendJson<{
    asset: { id: string };
    upload: { url: string; headers: Record<string, string> } | null;
  }>(page, urls, "POST", "/admin/media/uploads", {
    mime: "image/png",
    bytes: PNG.length,
    sha256: createHash("sha256").update(PNG).digest("hex"),
  });
  const mediaId = upload.asset.id;
  if (upload.upload) {
    const put = await page.request.put(upload.upload.url, {
      headers: upload.upload.headers,
      data: PNG,
    });
    expect(put.ok()).toBe(true);
    await sendJson(page, urls, "POST", `/admin/media/${mediaId}/commit`, {});
  }
  await expect
    .poll(
      async () =>
        (await adminGet<{ status: string }>(page, urls, `/admin/media/${mediaId}`)).status,
      { timeout: 60_000 },
    )
    .toBe("ready");
  await sendJson(page, urls, "PATCH", `/admin/media/${mediaId}`, {
    altAr: "صورة اختبار",
    altEn: "Test image",
  });
  return mediaId;
}

/** `count` distinct words: distinct text keeps the duplicate-content gate quiet between seeded items. */
export const wordsOf = (tag: string, count: number): string =>
  Array.from({ length: count }, (_, index) => `${tag}${String(index)}`).join(" ");
