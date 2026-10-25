import { verifyPreviewToken } from "@wasfa/shared/content/preview-token";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminContentController } from "../src/content/admin-content.controller.js";
import { PreviewTokenService } from "../src/content/preview-token.service.js";

import { NOW, fakeRepo, fakeSettings, ids, makeItem } from "./support/content-fixtures.js";

import type { ContentItemsRepo } from "../src/content/items.repo.js";
import type { SettingsService } from "../src/settings/settings.service.js";

const SECRET = "s".repeat(40);

function build(env: Record<string, unknown>, item = makeItem()) {
  const repo = fakeRepo(item);
  repo.findItem.mockImplementation(
    (id: string) => Promise.resolve(id === item.id ? item : undefined) as never,
  );
  return new PreviewTokenService(
    { WEB_ORIGIN: ["https://wasfa.online", "https://x.example"], ...env } as never,
    repo as unknown as ContentItemsRepo,
    fakeSettings({ previewTokenHours: 6 }) as unknown as SettingsService,
  );
}

describe("PreviewTokenService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs a link on the first web origin that lives for previewTokenHours", async () => {
    const { url, expiresAt } = await build({ CONTENT_PREVIEW_SECRET: SECRET }).create(ids.item);
    expect(expiresAt).toBe(new Date(NOW.getTime() + 6 * 3_600_000).toISOString());
    expect(url.startsWith("https://wasfa.online/preview/")).toBe(true);
    const token = url.slice("https://wasfa.online/preview/".length);
    expect(verifyPreviewToken(SECRET, token, NOW)).toMatchObject({ itemId: ids.item });
    expect(verifyPreviewToken(SECRET, token, new Date(NOW.getTime() + 7 * 3_600_000))).toBeNull();
  });

  it("answers NOT_FOUND when previews are switched off or the item is unknown", async () => {
    await expect(build({}).create(ids.item)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(build({ CONTENT_PREVIEW_SECRET: SECRET }).create(ids.other)).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });
});

/*
 * The route-level permission matrix (CONTENT-PLATFORM §11.4), read from the decorators' metadata:
 * the guard that enforces it is shared and tested elsewhere, this pins what each route asks for.
 */
describe("AdminContentController permissions", () => {
  const key = "wasfa:permissions";
  const required = (method: keyof AdminContentController) =>
    Reflect.getMetadata(key, AdminContentController.prototype[method]) as string[] | undefined;

  it.each([
    ["list", ["content.read"]],
    ["get", ["content.read"]],
    ["revisions", ["content.read"]],
    ["revision", ["content.read"]],
    ["create", ["content.write"]],
    ["update", ["content.write"]],
    ["autosave", ["content.write"]],
    ["renderPreview", ["content.write"]],
    ["previewToken", ["content.write"]],
    ["restore", ["content.write"]],
    ["correction", ["content.publish"]],
    // Each action's own permission is enforced by the workflow state machine.
    ["act", ["content.read"]],
  ] as const)("%s asks for %j", (method, permissions) => {
    expect(required(method)).toEqual(permissions);
  });

  it("every route declares a permission (an /admin route without one is refused by the guard)", () => {
    const methods = Object.getOwnPropertyNames(AdminContentController.prototype).filter(
      (name) => name !== "constructor",
    );
    for (const name of methods) {
      expect(required(name as keyof AdminContentController), name).toBeDefined();
    }
  });
});
