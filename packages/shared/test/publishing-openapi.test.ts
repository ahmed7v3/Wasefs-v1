import { describe, expect, it } from "vitest";

import { publishingOpenApiSchema } from "../src/schemas/publishing-openapi.js";

const validDocument = {
  openapi: "3.1.0",
  info: { title: "Publishing API", version: "1.0.0", additive: true },
  servers: [{ url: "https://api.example.test/publishing/v1" }],
  paths: {
    "/articles": {
      post: {
        summary: "Create article",
        "x-required-scope": "content:write",
        parameters: [{ name: "Idempotency-Key", in: "header", required: true }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Created", content: { "application/json": { schema: {} } } } },
        additiveOperationField: "accepted",
      },
    },
  },
};

describe("publishingOpenApiSchema", () => {
  it("validates the fields used by the viewer and accepts additive OpenAPI fields", () => {
    expect(publishingOpenApiSchema.parse(validDocument)).toMatchObject({
      info: { additive: true },
      paths: { "/articles": { post: { additiveOperationField: "accepted" } } },
    });
  });

  it("rejects malformed OpenAPI versions, servers, paths, and operation summaries", () => {
    expect(publishingOpenApiSchema.safeParse({ ...validDocument, openapi: "2.0" }).success).toBe(false);
    expect(
      publishingOpenApiSchema.safeParse({ ...validDocument, servers: [{ url: "not a URL" }] }).success,
    ).toBe(false);
    expect(
      publishingOpenApiSchema.safeParse({ ...validDocument, paths: { articles: {} } }).success,
    ).toBe(false);
    expect(
      publishingOpenApiSchema.safeParse({
        ...validDocument,
        paths: { "/articles": { post: { ...validDocument.paths["/articles"].post, summary: 5 } } },
      }).success,
    ).toBe(false);
  });
});
