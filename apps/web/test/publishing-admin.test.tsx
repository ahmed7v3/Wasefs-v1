// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import {
  publishingKeyInputSchema,
  type PublishingKey,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishingConnectView } from "../src/components/admin/publishing-connect-view";
import { PublishingDocsView } from "../src/components/admin/publishing-docs-view";
import { PublishingKeysView } from "../src/components/admin/publishing-keys-view";
import { keyStatus, publishingBaseUrl } from "../src/lib/publishing-admin";
import { ReauthProvider } from "../src/lib/reauth";

const SECRET = `wsk_live_ABCDEFGHIJKL_${"x9".repeat(22)}`;
const ID = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const baseKey: PublishingKey = {
  id: ID,
  name: "Claude articles",
  environment: "live",
  scopes: ["content:read", "content:write"],
  canPublish: false,
  requireSignature: true,
  allowedTypes: [],
  allowedCategorySlugs: [],
  defaultAuthorId: null,
  defaultFeaturedMediaId: null,
  dailyPublishCap: null,
  requestsPerMinute: 60,
  ipAllowList: [],
  prefix: "wsk_live_ABCDEFGHIJKL",
  last4: "9x9x",
  ownerUserId: "22222222-2222-4222-8222-222222222222",
  ownerName: "Sara",
  createdAt: iso(-10),
  expiresAt: iso(300),
  lastUsedAt: null,
  revokedAt: null,
  rotationGraceUntil: null,
  usage: { requestsToday: 12, errorsToday: 2, itemsCreatedToday: 3, publishedToday: 1 },
};
const keys: PublishingKey[] = [
  baseKey,
  { ...baseKey, id: "33333333-3333-4333-8333-333333333333", name: "Soon", expiresAt: iso(5) },
  { ...baseKey, id: "44444444-4444-4444-8444-444444444444", name: "Old", expiresAt: iso(-1) },
  {
    ...baseKey,
    id: "55555555-5555-4555-8555-555555555555",
    name: "Gone",
    revokedAt: iso(-2),
  },
];

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes(path) && (init?.method ?? "GET") === method,
  );
const bodyOf = (call: Parameters<typeof fetch> | undefined): unknown =>
  JSON.parse(String(call?.[1]?.body));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/admin/content/api-keys") && method === "GET") {
      return Promise.resolve(json({ items: keys }));
    }
    if (path.endsWith("/admin/content/api-keys") && method === "POST") {
      return Promise.resolve(json({ key: baseKey, secret: SECRET }));
    }
    if (path.includes("/rotate")) return Promise.resolve(json({ key: baseKey, secret: SECRET }));
    if (path.includes("/revoke")) {
      return Promise.resolve(json({ ...baseKey, revokedAt: iso(0) }));
    }
    if (path.includes("/requests")) {
      return Promise.resolve(
        json({
          items: [
            {
              at: iso(0),
              method: "POST",
              route: "/publishing/v1/content",
              status: 422,
              latencyMs: 87,
              errorCode: "VALIDATION_FAILED",
              itemId: null,
            },
          ],
        }),
      );
    }
    if (path.includes("/admin/content/people")) return Promise.resolve(json({ items: [] }));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderKeys = () =>
  render(
    <ToastProvider>
      <ReauthProvider>
        <PublishingKeysView />
      </ReauthProvider>
    </ToastProvider>,
  );

const openRowAction = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  action: string,
) => {
  const triggers = await screen.findAllByRole("button", {
    name: t("admin.pub.action.menu", { name }),
  });
  await user.click(triggers[0] as HTMLElement);
  const items = await screen.findAllByRole("button", { name: action });
  await user.click(items[0] as HTMLElement);
};

describe("keyStatus", () => {
  it("derives revoked, expired, expiring soon and active", () => {
    expect(keyStatus(keys[0] as PublishingKey)).toBe("active");
    expect(keyStatus(keys[1] as PublishingKey)).toBe("expiring");
    expect(keyStatus(keys[2] as PublishingKey)).toBe("expired");
    expect(keyStatus(keys[3] as PublishingKey)).toBe("revoked");
  });
});

describe("PublishingKeysView", () => {
  it("lists keys with the masked prefix, scopes, usage and a status badge each", async () => {
    renderKeys();
    expect((await screen.findAllByText("Claude articles")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("wsk_live_ABCDEFGHIJKL…9x9x").length).toBeGreaterThan(0);
    expect(screen.getAllByText("content:write").length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.pub.status.active")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.pub.status.expiring")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.pub.status.expired")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.pub.status.revoked")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(t("admin.pub.usage.today", { requests: 12, errors: 2, published: 1 }))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.pub.canPublish.no")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("admin.pub.signature.required")).length).toBeGreaterThan(0);
  });

  it("creates a key with a payload valid for the shared schema, shows the full key once and leaves nothing in the DOM", async () => {
    const user = userEvent.setup();
    renderKeys();
    await user.click(await screen.findByRole("button", { name: t("admin.pub.keys.create") }));
    await user.type(
      await screen.findByLabelText(t("admin.pub.form.name"), { exact: false }),
      "Writer bot",
    );
    await user.click(screen.getByLabelText(t("admin.pub.scope.media:write")));
    await user.click(screen.getByLabelText(t("admin.pub.form.canPublish")));
    await user.click(screen.getByLabelText(t("admin.pub.form.requireSignature")));
    await user.click(screen.getByLabelText(t("admin.pub.type.article")));
    await user.type(screen.getByLabelText(t("admin.pub.form.categories")), "diabetes{Enter}");
    await user.type(screen.getByLabelText(t("admin.pub.form.ipAllowList")), "10.0.0.0/8\n1.2.3.4");
    await user.click(screen.getByLabelText(t("admin.pub.form.dailyCap.globalOnly")));
    await user.clear(screen.getByLabelText(t("admin.pub.form.dailyCap")));
    await user.type(screen.getByLabelText(t("admin.pub.form.dailyCap")), "5");
    expect(screen.getByText(t("admin.pub.form.canPublish.warning"))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("admin.pub.form.submitCreate") }));

    await waitFor(() => {
      expect(calls("POST", "/admin/content/api-keys")).toHaveLength(1);
    });
    const body = bodyOf(calls("POST", "/admin/content/api-keys")[0]);
    const parsed = publishingKeyInputSchema.parse(body);
    expect(parsed).toMatchObject({
      name: "Writer bot",
      environment: "live",
      scopes: ["content:read", "content:write", "media:write"],
      canPublish: true,
      requireSignature: true,
      allowedTypes: ["article"],
      allowedCategorySlugs: ["diabetes"],
      ipAllowList: ["10.0.0.0/8", "1.2.3.4"],
      dailyPublishCap: 5,
      requestsPerMinute: 60,
      expiresInDays: 365,
    });

    // The secret is shown once, with the endpoint and a ready message that carries the key.
    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(screen.getByText(t("admin.pub.secret.warning"))).toBeTruthy();
    const base = publishingBaseUrl();
    expect(screen.getByText(base)).toBeTruthy();
    expect(screen.getByText(t("admin.pub.claudeMessage", { base, key: SECRET }))).toBeTruthy();

    await user.click(screen.getByRole("button", { name: t("admin.pub.secret.saved") }));
    await waitFor(() => {
      expect(screen.queryByText(SECRET)).toBeNull();
    });
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("x9x9x9");
  });

  it("does not submit an invalid form (no name, no scope)", async () => {
    const user = userEvent.setup();
    renderKeys();
    await user.click(await screen.findByRole("button", { name: t("admin.pub.keys.create") }));
    await user.click(await screen.findByLabelText(t("admin.pub.scope.content:read")));
    await user.click(screen.getByLabelText(t("admin.pub.scope.content:write")));
    await user.click(screen.getByRole("button", { name: t("admin.pub.form.submitCreate") }));
    expect(await screen.findByText(t("admin.pub.form.invalid"))).toBeTruthy();
    expect(calls("POST", "/admin/content/api-keys")).toHaveLength(0);
  });

  it("edits only the updatable fields with PATCH", async () => {
    const user = userEvent.setup();
    renderKeys();
    await openRowAction(user, "Claude articles", t("admin.pub.action.edit"));
    const name = await screen.findByLabelText(t("admin.pub.form.name"), { exact: false });
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByLabelText(t("admin.pub.form.requireSignature")));
    expect(screen.queryByLabelText(t("admin.pub.form.expiresInDays"))).toBeNull();
    await user.click(screen.getByRole("button", { name: t("admin.pub.form.submitEdit") }));
    await waitFor(() => {
      expect(calls("PATCH", `/admin/content/api-keys/${ID}`)).toHaveLength(1);
    });
    const body = bodyOf(calls("PATCH", `/admin/content/api-keys/${ID}`)[0]) as Record<
      string,
      unknown
    >;
    expect(body["name"]).toBe("Renamed");
    expect(body["requireSignature"]).toBe(false);
    expect(body).not.toHaveProperty("environment");
    expect(body).not.toHaveProperty("expiresInDays");
  });

  it("rotates with a grace period and shows the new key once", async () => {
    const user = userEvent.setup();
    renderKeys();
    await openRowAction(user, "Claude articles", t("admin.pub.action.rotate"));
    const grace = await screen.findByLabelText(t("admin.pub.rotate.graceHours"));
    await user.clear(grace);
    await user.type(grace, "12");
    await user.click(screen.getByRole("button", { name: t("admin.pub.rotate.confirm") }));
    await waitFor(() => {
      expect(calls("POST", `/admin/content/api-keys/${ID}/rotate`)).toHaveLength(1);
    });
    expect(bodyOf(calls("POST", `/admin/content/api-keys/${ID}/rotate`)[0])).toEqual({
      graceHours: 12,
    });
    expect(await screen.findByText(SECRET)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("admin.pub.secret.saved") }));
    await waitFor(() => {
      expect(document.body.textContent).not.toContain(SECRET);
    });
  });

  it("revokes after the explicit confirmation", async () => {
    const user = userEvent.setup();
    renderKeys();
    await openRowAction(user, "Claude articles", t("admin.pub.action.revoke"));
    expect(calls("POST", "/revoke")).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: t("admin.pub.revoke.confirm") }));
    await waitFor(() => {
      expect(calls("POST", `/admin/content/api-keys/${ID}/revoke`)).toHaveLength(1);
    });
  });

  it("shows the recent requests of a key", async () => {
    const user = userEvent.setup();
    renderKeys();
    await openRowAction(user, "Claude articles", t("admin.pub.action.requests"));
    const table = await screen.findByRole("table", { name: t("admin.pub.requests.table") });
    expect(within(table).getByText("/publishing/v1/content")).toBeTruthy();
    expect(within(table).getByText("422")).toBeTruthy();
    expect(within(table).getByText("VALIDATION_FAILED")).toBeTruthy();
    expect(within(table).getByText(t("admin.pub.requests.ms", { ms: 87 }))).toBeTruthy();
    expect(calls("GET", `/admin/content/api-keys/${ID}/requests?limit=50`)).toHaveLength(1);
  });
});

describe("PublishingConnectView", () => {
  const guideUrl = `${publishingBaseUrl()}/guide`;

  it("fetches the guide at runtime and offers it, the endpoint and the links to copy", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("# Wasfa guide\nstep one")));
    render(
      <ToastProvider>
        <PublishingConnectView />
      </ToastProvider>,
    );
    expect(await screen.findByText(/# Wasfa guide/)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(guideUrl);
    expect(screen.getAllByText(publishingBaseUrl()).length).toBeGreaterThan(0);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toContain(`${publishingBaseUrl()}/openapi.json`);
    expect(hrefs).toContain(guideUrl);
    expect(hrefs).toContain("/admin/content/api/docs");
    expect(
      screen.getByText(t("admin.pub.claudeMessage.template", { base: publishingBaseUrl() })),
    ).toBeTruthy();
    for (const step of ["step1", "step2", "step3", "step4"] as const) {
      expect(screen.getByText(t(`admin.pub.connect.${step}.title`))).toBeTruthy();
    }
    expect(screen.getByText(t("admin.pub.connect.trouble.429"))).toBeTruthy();
  });

  it("falls back to the link when the guide cannot be loaded", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("no", { status: 500 })));
    render(
      <ToastProvider>
        <PublishingConnectView />
      </ToastProvider>,
    );
    expect(await screen.findByText(t("admin.pub.connect.guide.error"))).toBeTruthy();
    const open = screen.getByRole("link", { name: t("admin.pub.connect.guide.open") });
    expect(open.getAttribute("href")).toBe(guideUrl);
    expect(screen.queryByRole("button", { name: t("admin.pub.connect.guide.copy") })).toBeNull();
  });
});

describe("PublishingDocsView", () => {
  it("validates and renders the public OpenAPI routes, then filters them", async () => {
    const user = userEvent.setup();
    const openapiUrl = `${publishingBaseUrl()}/openapi.json`;
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json({
          openapi: "3.1.0",
          info: { title: "Publishing", version: "1.0.0" },
          servers: [{ url: publishingBaseUrl() }],
          paths: {
            "/articles": {
              get: {
                summary: "List articles",
                "x-required-scope": "content:read",
                parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer" } }],
                responses: { "200": { description: "Article list" } },
              },
              post: {
                summary: "Create article",
                "x-required-scope": "content:write",
                security: [{ bearerAuth: [] }],
                requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
                responses: { "201": { description: "Created" } },
              },
            },
            "/openapi.json": {
              get: { summary: "OpenAPI specification", security: [], responses: { "200": { description: "Spec" } } },
            },
          },
        }),
      ),
    );
    render(<PublishingDocsView />);

    expect(await screen.findByText("List articles")).toBeTruthy();
    expect(screen.getByText("Create article")).toBeTruthy();
    expect(screen.getByText(t("admin.pub.docs.authPublic"))).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(openapiUrl);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("omit");

    await user.selectOptions(screen.getByLabelText(t("admin.pub.docs.methodFilter")), "post");
    expect(screen.getByText("Create article")).toBeTruthy();
    expect(screen.queryByText("List articles")).toBeNull();
    await user.selectOptions(screen.getByLabelText(t("admin.pub.docs.methodFilter")), "");
    await user.clear(screen.getByLabelText(t("admin.pub.docs.searchLabel")));
    await user.type(screen.getByLabelText(t("admin.pub.docs.searchLabel")), "content:read");
    expect(screen.getByText("List articles")).toBeTruthy();
    expect(screen.queryByText("Create article")).toBeNull();
  });
});
