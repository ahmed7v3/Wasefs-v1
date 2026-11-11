import { PUBLISHING_API_BASE } from "@wasfa/shared/publishing";
import { publishingErrorSchema } from "@wasfa/shared/schemas/publishing";
import { z } from "zod";

import { PUBLISHING_ROUTES, type RouteDef } from "./publishing-api-route-table.js";

/*
 * OpenAPI 3.1 for the Publishing API, generated from the route table and the zod schemas the server
 * validates with (zod's own JSON Schema converter), so a field added to a schema is in the spec the
 * same day. Paths are assembled from `PUBLISHING_ROUTES`, the one list the controllers are tested against.
 */

type Json = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const converted = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    unrepresentable: "any",
  }) as Json;
  delete converted.$schema;
  return converted;
}

const ERROR_RESPONSES: Record<string, string> = {
  "400": "VALIDATION_FAILED: see details.fields and details.messages",
  "401": "AUTH_REQUIRED / INVALID_SIGNATURE: missing, unknown, expired or revoked key",
  "403": "FORBIDDEN / SCOPE_REQUIRED: scope, type or category not allowed for this key",
  "404": "NOT_FOUND: unknown id, or not visible to this key",
  "409": "CONFLICT / IDEMPOTENCY_MISMATCH / CONTENT_SLUG_TAKEN: see code and details",
  "422":
    "CONTENT_GATES_BLOCK: blocking quality issues in details.blocking (the item is saved as a draft)",
  "429": "RATE_LIMITED / CONTENT_PUBLISH_CAP / PUBLISHING_CREATE_CAP: honour Retry-After",
};

function pathParameters(path: string): Json[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

function queryParameters(route: RouteDef): Json[] {
  if (route.query === undefined) return [];
  const schema = jsonSchema(route.query, "input");
  const properties = (schema.properties ?? {}) as Record<string, Json>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([name, value]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: value,
  }));
}

function operation(route: RouteDef): Json {
  const parameters: Json[] = [...pathParameters(route.path), ...queryParameters(route)];
  if (route.idempotent) {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description:
        "A unique key per logical create (8-128 chars). Same key and same body replays the stored answer for 24 h; same key and a different body is 409 IDEMPOTENCY_MISMATCH.",
      schema: { type: "string", minLength: 8, maxLength: 128 },
    });
  }
  if (route.ifMatch === true) {
    parameters.push({
      name: "If-Match",
      in: "header",
      required: false,
      description:
        'The revision you based the change on, e.g. "3" (the ETag of a previous answer). A mismatch is 412.',
      schema: { type: "string" },
    });
  }

  const content =
    route.success.contentType !== undefined
      ? { [route.success.contentType]: { schema: { type: "string" } } }
      : route.success.schema === undefined
        ? undefined
        : { "application/json": { schema: jsonSchema(route.success.schema, "output") } };

  const responses: Record<string, Json> = {
    [String(route.success.status)]: {
      description: route.success.description,
      ...(content === undefined ? {} : { content }),
    },
  };
  if (route.auth === "key") {
    for (const [status, description] of Object.entries(ERROR_RESPONSES)) {
      responses[status] = {
        description,
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
    }
  }

  const requestBody =
    route.body !== undefined
      ? {
          required: true,
          content: { "application/json": { schema: jsonSchema(route.body, "input") } },
        }
      : route.multipart !== undefined
        ? {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: { type: "string", format: "binary" },
                    ...((jsonSchema(route.multipart, "input").properties ?? {}) as Json),
                  },
                },
              },
            },
          }
        : undefined;

  return {
    operationId: `${route.method}${route.path.replace(/[^A-Za-z0-9]+(\w)?/g, (_m, c: string | undefined) => (c ?? "").toUpperCase())}`,
    summary: route.summary,
    tags: [route.tag],
    ...(route.auth === "public" ? { security: [] } : {}),
    ...(route.scope === null
      ? {}
      : { description: `Requires the \`${route.scope}\` scope.`, "x-required-scope": route.scope }),
    parameters,
    ...(requestBody === undefined ? {} : { requestBody }),
    responses,
  };
}

export function buildOpenApiDocument(options: { apiBase: string }): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const route of PUBLISHING_ROUTES) {
    (paths[route.path] ??= {})[route.method] = operation(route);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Wasfa Publishing API",
      version: "1.0.0",
      description:
        "Create, validate, illustrate and publish content with an API key. AI agents: read GET /guide first. Medical categories always pass human review before anything is public.",
    },
    servers: [{ url: `${options.apiBase.replace(/\/+$/, "")}${PUBLISHING_API_BASE}` }],
    security: [{ bearerAuth: [] }],
    tags: ["Meta", "Articles", "Media", "Taxonomy"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Authorization: Bearer wsk_live_<key_id>_<secret>",
        },
      },
      schemas: { Error: jsonSchema(publishingErrorSchema, "output") },
    },
  };
}
