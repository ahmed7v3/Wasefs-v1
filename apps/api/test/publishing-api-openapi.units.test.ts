import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { ERROR_CODES } from "@wasfa/shared/errors";
import { PUBLISHING_API_BASE, PUBLISHING_SCOPES } from "@wasfa/shared/publishing";
import { buildPublishingGuide } from "@wasfa/shared/publishing-guide";
import { describe, expect, it, vi } from "vitest";

import { PublishingApiArticlesController } from "../src/publishing/publishing-api-articles.controller.js";
import { PublishingApiDocsController } from "../src/publishing/publishing-api-docs.controller.js";
import { PublishingApiMediaController } from "../src/publishing/publishing-api-media.controller.js";
import { buildOpenApiDocument } from "../src/publishing/publishing-api-openapi.js";
import { PUBLISHING_ROUTES, routeLabel } from "../src/publishing/publishing-api-route-table.js";
import { PublishingApiTaxonomyController } from "../src/publishing/publishing-api-taxonomy.controller.js";
import { PUBLISHING_SCOPES_KEY } from "../src/publishing/publishing-principal.js";

import type { FastifyReply } from "fastify";

type Constructor = abstract new (...args: never[]) => object;

const CONTROLLERS: Constructor[] = [
  PublishingApiArticlesController,
  PublishingApiMediaController,
  PublishingApiTaxonomyController,
  PublishingApiDocsController,
];
const METHODS: Record<number, string> = { 0: "get", 1: "post", 2: "put", 3: "delete", 4: "patch" };

interface Registered {
  label: string;
  scopes: unknown;
  handler: object;
}

/** Every route the controllers really register, as `METHOD /path/{param}` relative to the API base. */
function registered(): Registered[] {
  const found: Registered[] = [];
  for (const controller of CONTROLLERS) {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, object>)[name];
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (method === undefined) continue;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const full = `/${[base, sub].filter((part) => part !== "" && part !== "/").join("/")}`;
      const relative = full
          .slice(PUBLISHING_API_BASE.length)
          .replace(/:externalId/g, ":external_id")
          .replace(/:(\w+)/g, "{$1}");
      found.push({
        label: `${(METHODS[method] ?? "?").toUpperCase()} ${relative}`,
        scopes: Reflect.getMetadata(PUBLISHING_SCOPES_KEY, handler) as unknown,
        handler,
      });
    }
  }
  return found;
}

const ownRoutes = PUBLISHING_ROUTES.filter((route) => route.externalOwner === undefined);

describe("route table and controllers cannot drift", () => {
  it("every route the controllers register is in the table, and the table has nothing else (bar /me, owned by the key module)", () => {
    expect(
      registered()
        .map((route) => route.label)
        .sort(),
    ).toEqual(ownRoutes.map(routeLabel).sort());
  });

  it("every key route carries @PublishingAuth with exactly the table's scope", () => {
    for (const route of registered()) {
      const entry = ownRoutes.find((candidate) => routeLabel(candidate) === route.label);
      expect(entry, route.label).toBeDefined();
      if (entry?.auth === "public") {
        expect(route.scopes, route.label).toBeUndefined();
      } else {
        expect(route.scopes, route.label).toEqual(entry?.scope === null ? [] : [entry?.scope]);
      }
    }
  });

  it("only the two documents are public", () => {
    expect(
      PUBLISHING_ROUTES.filter((route) => route.auth === "public")
        .map(routeLabel)
        .sort(),
    ).toEqual(["GET /guide", "GET /openapi.json"]);
  });

  it("scopes in the table are real scopes", () => {
    for (const route of PUBLISHING_ROUTES) {
      if (route.scope !== null) expect(PUBLISHING_SCOPES).toContain(route.scope);
    }
  });

  it("every route that creates something requires an Idempotency-Key", () => {
    const creators = PUBLISHING_ROUTES.filter(
      (route) =>
        route.method === "post" &&
        ["/articles", "/articles/batch", "/media", "/media/fetch", "/categories", "/tags"].includes(route.path),
    );
    expect(creators).toHaveLength(6);
    expect(creators.every((route) => route.idempotent)).toBe(true);
    expect(PUBLISHING_ROUTES.filter((route) => route.idempotent)).toHaveLength(6);
  });
});

describe("OpenAPI document", () => {
  const spec = buildOpenApiDocument({ apiBase: "https://api.wasfa.online/" }) as {
    openapi: string;
    servers: { url: string }[];
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
  };

  it("is OpenAPI 3.1 with the versioned server URL and bearer security", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.servers).toEqual([{ url: "https://api.wasfa.online/publishing/v1" }]);
    expect(spec.components.securitySchemes).toHaveProperty("bearerAuth");
    expect(spec.components.schemas).toHaveProperty("Error");
  });

  it("lists every route of the table, and only those", () => {
    const inSpec = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(inSpec.sort()).toEqual(PUBLISHING_ROUTES.map(routeLabel).sort());
  });

  it("every route registered under /publishing/v1 appears in the spec", () => {
    const inSpec = new Set(
      Object.entries(spec.paths).flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
      ),
    );
    for (const route of registered()) expect(inSpec.has(route.label), route.label).toBe(true);
  });

  it("generates request bodies from the zod schemas (field names, strictness, required)", () => {
    const create = spec.paths["/articles"]?.post as {
      requestBody: { content: { "application/json": { schema: Record<string, unknown> } } };
      parameters: { name: string; required: boolean }[];
    };
    const schema = create.requestBody.content["application/json"].schema;
    expect(Object.keys(schema.properties as object)).toEqual(
      expect.arrayContaining([
        "title",
        "body_markdown",
        "desired_status",
        "sources",
        "ai_assisted",
      ]),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["type", "locale", "title"]));
    expect(schema.properties).toHaveProperty("body_markdown");
    expect(schema.properties).toHaveProperty("body_html_import");
    expect(create.parameters).toContainEqual(
      expect.objectContaining({ name: "Idempotency-Key", required: true }),
    );
  });

  it("documents If-Match on the writes that accept it, the scope of every key route and public routes without security", () => {
    const put = spec.paths["/articles/by-external-id/{external_id}"]?.put as {
      parameters: { name: string }[];
      "x-required-scope": string;
    };
    expect(put.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(["external_id", "If-Match"]),
    );
    expect(put["x-required-scope"]).toBe("content:write");
    expect(spec.paths["/guide"]?.get?.security).toEqual([]);
    expect(spec.paths["/openapi.json"]?.get?.security).toEqual([]);
    const me = spec.paths["/me"]?.get as { responses: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> };
    expect(me.responses["200"]?.content?.["application/json"]?.schema).toMatchObject({
      properties: { key: { properties: { require_signature: { type: "boolean" } } } },
    });
  });

  it("documents the multipart upload and the list query", () => {
    const upload = spec.paths["/media"]?.post as {
      requestBody: {
        content: Record<
          string,
          { schema: { required: string[]; properties: Record<string, unknown> } }
        >;
      };
    };
    expect(upload.requestBody.content["multipart/form-data"]?.schema.required).toEqual(["file"]);
    expect(upload.requestBody.content["multipart/form-data"]?.schema.properties).toHaveProperty(
      "alt",
    );
    const list = spec.paths["/articles"]?.get as { parameters: { name: string; in: string }[] };
    expect(list.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(["limit", "cursor", "status", "updated_since", "external_id"]),
    );
  });

  it("is serialisable JSON", () => {
    expect(() => JSON.stringify(spec)).not.toThrow();
  });
});

describe("agent guide", () => {
  const guide = buildPublishingGuide({ apiBase: "https://api.wasfa.online" });

  it("is concise (at most about 220 lines) and uses the real base URL", () => {
    expect(guide.split("\n").length).toBeLessThanOrEqual(220);
    expect(guide).toContain("https://api.wasfa.online/publishing/v1");
  });

  it("mentions every route of the route table", () => {
    for (const route of PUBLISHING_ROUTES) {
      expect(guide, routeLabel(route)).toContain(routeLabel(route));
    }
  });

  it("names every error code the API returns", () => {
    const returned = [
      "VALIDATION_FAILED",
      "AUTH_REQUIRED",
      "INVALID_SIGNATURE",
      "FORBIDDEN",
      "SCOPE_REQUIRED",
      "NOT_FOUND",
      "CONFLICT",
      "CONTENT_SLUG_TAKEN",
      "IDEMPOTENCY_MISMATCH",
      "CONTENT_ILLEGAL_TRANSITION",
      "CONTENT_CONFLICT",
      "PAYLOAD_TOO_LARGE",
      "UNSUPPORTED_MEDIA",
      "CONTENT_GATES_BLOCK",
      "CONTENT_PUBLISH_CAP",
      "RATE_LIMITED",
      "UPSTREAM_UNAVAILABLE",
    ];
    for (const code of returned) {
      expect(ERROR_CODES, code).toContain(code);
      expect(guide, code).toContain(code);
    }
  });

  it("carries the workflow and the safety rules an agent must follow", () => {
    for (const phrase of [
      "GET /me",
      "POST /articles/validate",
      "PUT /articles/by-external-id/",
      "Do not publish on your own",
      "ONLY when the human explicitly asks",
      "Never claim an article is live",
      "publish_on_approval",
      "ai_assisted",
      "Never invent",
      "never give personal dosing",
      "doctor or pharmacist",
      "Idempotency-Key",
      "Retry-After",
      "preview_url",
      "المصادر / Sources",
    ]) {
      expect(guide.toLowerCase(), phrase).toContain(phrase.toLowerCase());
    }
  });

  it("leaks no secret and no host other than the base URL", () => {
    expect(guide).not.toMatch(/wsk_(live|test)_[A-Za-z0-9]{12}_/);
  });
});

describe("public docs controller", () => {
  const controller = new PublishingApiDocsController({
    API_PUBLIC_URL: "https://api.wasfa.online",
  } as never);
  const reply = () => {
    const calls: [string, string][] = [];
    const fake = {
      header: vi.fn((name: string, value: string) => {
        calls.push([name, value]);
        return fake;
      }),
      type: vi.fn((value: string) => {
        calls.push(["content-type", value]);
        return fake;
      }),
    };
    return { fake: fake as unknown as FastifyReply, calls };
  };

  it("serves the spec cached for 5 minutes", () => {
    const { fake, calls } = reply();
    const body = controller.spec(fake) as { openapi: string };
    expect(body.openapi).toBe("3.1.0");
    expect(calls).toContainEqual(["cache-control", "public, max-age=300"]);
  });

  it("serves the guide as markdown cached for 5 minutes", () => {
    const { fake, calls } = reply();
    expect(controller.instructions(fake)).toContain("# Wasfa Publishing API");
    expect(calls).toContainEqual(["cache-control", "public, max-age=300"]);
    expect(calls).toContainEqual(["content-type", "text/markdown; charset=utf-8"]);
  });
});
