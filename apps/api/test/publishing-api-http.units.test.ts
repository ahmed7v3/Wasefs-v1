import { Catch, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { API_ENV } from "../src/config/config.module.js";
import { PublishingApiArticlesController } from "../src/publishing/publishing-api-articles.controller.js";
import { PublishingApiArticlesService } from "../src/publishing/publishing-api-articles.service.js";
import { PublishingApiDocsController } from "../src/publishing/publishing-api-docs.controller.js";
import { PublishingIdempotencyService } from "../src/publishing/publishing-api-idempotency.js";
import { PublishingApiRepo } from "../src/publishing/publishing-api.repo.js";
import { PublishingKeyGuard } from "../src/publishing/publishing-key.guard.js";
import {
  PUBLISHING_REQUEST_KEY,
  PUBLISHING_SCOPES_KEY,
  type PublishingPrincipal,
} from "../src/publishing/publishing-principal.js";

import type { FastifyReply } from "fastify";

/*
 * The HTTP surface with a Nest + Fastify app and a stand-in for the key guard: status codes, headers
 * (ETag, If-Match, Idempotency-Key, replay marker), strict body parsing, public documents, and that the
 * scope of each route is enforced by the (stand-in) guard from the decorator metadata.
 */

const KEY = "018f0000-0000-7000-8000-0000000000aa";
const principal: PublishingPrincipal = {
  keyId: KEY,
  keyName: "Agent",
  ownerUserId: "018f0000-0000-7000-8000-0000000000bb",
  scopes: ["content:read", "content:write"],
  canPublish: false,
  allowedTypes: [],
  allowedCategorySlugs: [],
  defaultAuthorId: null,
  defaultFeaturedMediaId: null,
  dailyPublishCap: null,
  requestsPerMinute: 60,
};

const articleBody = {
  type: "article",
  locale: "en",
  title: "How to take antibiotics correctly",
  excerpt:
    "Simple steps that help you follow the schedule and the length of your antibiotic course.",
  body_markdown: "## Why\n\nText.\n",
};

const answer = (revision = 1) => ({
  id: "018f0000-0000-7000-8000-000000000001",
  revision,
  status: "draft",
});

@Catch()
class TestFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (exception instanceof AppError) {
      void reply.status(exception.httpStatus).send(exception.toResponse("en"));
      return;
    }
    void reply
      .status(500)
      .send({ code: "INTERNAL", message: String((exception as Error).message) });
  }
}

/** What the real guard does with the decorator metadata: attach the principal and enforce the scopes. */
const guard = {
  canActivate(context: import("@nestjs/common").ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const scopes = (Reflect.getMetadata(PUBLISHING_SCOPES_KEY, context.getHandler()) ??
      []) as string[];
    if (!scopes.every((scope) => (principal.scopes as readonly string[]).includes(scope))) {
      throw new AppError(ErrorCode.SCOPE_REQUIRED);
    }
    request[PUBLISHING_REQUEST_KEY] = principal;
    return true;
  },
};

const memory = new Map<string, { hash: string; status: number | null; response: unknown }>();
const idempotencyRepo = {
  claimIdempotency: vi.fn((keyId: string, key: string, hash: string) => {
    if (memory.has(`${keyId}|${key}`)) return Promise.resolve(false);
    memory.set(`${keyId}|${key}`, { hash, status: null, response: null });
    return Promise.resolve(true);
  }),
  findIdempotency: vi.fn((keyId: string, key: string) => {
    const row = memory.get(`${keyId}|${key}`);
    return Promise.resolve(
      row ? { requestHash: row.hash, status: row.status, response: row.response } : undefined,
    );
  }),
  completeIdempotency: vi.fn((keyId: string, key: string, status: number, response: unknown) => {
    const row = memory.get(`${keyId}|${key}`);
    if (row) Object.assign(row, { status, response });
    return Promise.resolve();
  }),
  releaseIdempotency: vi.fn((keyId: string, key: string) => {
    memory.delete(`${keyId}|${key}`);
    return Promise.resolve();
  }),
};

const service = {
  create: vi.fn(() => Promise.resolve({ status: 201, article: answer(1) })),
  upsert: vi.fn(() => Promise.resolve({ status: 200, article: answer(4) })),
  patch: vi.fn(() => Promise.resolve(answer(5))),
  get: vi.fn(() => Promise.resolve(answer(2))),
  list: vi.fn(() => Promise.resolve({ items: [], next_cursor: null })),
  validate: vi.fn(() => Promise.resolve({ valid: true })),
  submit: vi.fn(() => Promise.resolve(answer(1))),
  publish: vi.fn(() => Promise.resolve(answer(1))),
  schedule: vi.fn(() => Promise.resolve(answer(1))),
  unpublish: vi.fn(() => Promise.resolve(answer(1))),
  remove: vi.fn(() => Promise.resolve({ id: "x", result: "deleted" })),
  revisions: vi.fn(() => Promise.resolve({ items: [] })),
};

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [PublishingApiArticlesController, PublishingApiDocsController],
    providers: [
      { provide: PublishingApiArticlesService, useValue: service },
      { provide: PublishingApiRepo, useValue: idempotencyRepo },
      PublishingIdempotencyService,
      { provide: API_ENV, useValue: { API_PUBLIC_URL: "https://api.wasfa.online" } },
      { provide: APP_FILTER, useClass: TestFilter },
    ],
  })
    .overrideGuard(PublishingKeyGuard)
    .useValue(guard)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

const call = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
) =>
  app.inject({
    method,
    url: `/publishing/v1${url}`,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
  });

describe("public documents", () => {
  it("serves the OpenAPI spec without a key, cached 5 minutes", async () => {
    const response = await call("GET", "/openapi.json");
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect((response.json() as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("serves the guide as markdown without a key", async () => {
    const response = await call("GET", "/guide");
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["content-type"])).toContain("text/markdown");
    expect(response.body).toContain("https://api.wasfa.online/publishing/v1");
  });
});

describe("POST /articles", () => {
  it("needs an Idempotency-Key", async () => {
    const response = await call("POST", "/articles", { body: articleBody });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["Idempotency-Key"] },
    });
    expect(service.create).not.toHaveBeenCalled();
  });

  it("answers 201 with an ETag, replays the stored answer for the same key and body, refuses a different body", async () => {
    const headers = { "idempotency-key": "create-http-0001" };
    const first = await call("POST", "/articles", { body: articleBody, headers });
    expect(first.statusCode).toBe(201);
    expect(first.headers.etag).toBe('"1"');
    expect(first.headers["idempotent-replayed"]).toBeUndefined();

    const replay = await call("POST", "/articles", { body: articleBody, headers });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
    expect(service.create).toHaveBeenCalledTimes(1);

    const mismatch = await call("POST", "/articles", {
      body: { ...articleBody, title: "A completely different title" },
      headers,
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("a rejected body does not consume the key and names the field and the rule", async () => {
    const response = await call("POST", "/articles", {
      body: { ...articleBody, bodyMarkdown: "typo" },
      headers: { "idempotency-key": "create-http-0002" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(memory.has(`${KEY}|create-http-0002`)).toBe(false);
  });

  it("an Arabic title without a slug is refused with the slug message", async () => {
    const response = await call("POST", "/articles", {
      body: { ...articleBody, locale: "ar", title: "كيف تتناول المضاد الحيوي بطريقة صحيحة" },
      headers: { "idempotency-key": "create-http-0003" },
    });
    expect(response.statusCode).toBe(400);
    const details = (response.json() as { details: { fields: string[]; messages: string[] } })
      .details;
    expect(details.fields).toEqual(["slug"]);
    expect(details.messages[0]).toMatch(/English slug/);
  });
});

describe("PUT /articles/by-external-id/{external_id}", () => {
  it("passes the external id and If-Match to the service and sets the ETag", async () => {
    const response = await call("PUT", "/articles/by-external-id/kb-1042", {
      body: articleBody,
      headers: { "if-match": '"3"' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"4"');
    const args = service.upsert.mock.calls.at(-1) as unknown as unknown[];
    expect(args[2]).toBe("kb-1042");
    expect(args[4]).toBe(3);
  });

  it("refuses an external id outside the documented alphabet", async () => {
    const response = await call("PUT", "/articles/by-external-id/bad%20id", { body: articleBody });
    expect(response.statusCode).toBe(400);
  });

  it("a stale revision from the service is surfaced as 412", async () => {
    service.upsert.mockRejectedValueOnce(
      new AppError(ErrorCode.CONTENT_CONFLICT, {
        httpStatus: 412,
        details: { current_revision: 7 },
      }),
    );
    const response = await call("PUT", "/articles/by-external-id/kb-1042", {
      body: articleBody,
      headers: { "if-match": '"3"' },
    });
    expect(response.statusCode).toBe(412);
    expect(response.json()).toMatchObject({
      code: "CONTENT_CONFLICT",
      details: { current_revision: 7 },
    });
  });
});

describe("the other article routes", () => {
  it("PATCH, GET, list, submit, publish, schedule, unpublish, delete, revisions, validate reach their handlers", async () => {
    // The stand-in key may read and write but not publish (scope check below), so grant it for this test.
    principal.scopes = ["content:read", "content:write", "content:publish"];
    expect(
      (
        await call("PATCH", "/articles/018f0000-0000-7000-8000-000000000001", {
          body: { ai_assisted: true },
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("GET", "/articles/018f0000-0000-7000-8000-000000000001")).headers.etag).toBe(
      '"2"',
    );
    expect((await call("GET", "/articles?limit=5&status=draft")).statusCode).toBe(200);
    expect((await call("POST", "/articles/validate", { body: articleBody })).statusCode).toBe(200);
    expect(service.validate).toHaveBeenCalledTimes(1);
    expect(service.create).not.toHaveBeenCalled(); // validate is not create
    expect((await call("POST", "/articles/x/submit", { body: {} })).statusCode).toBe(200);
    expect(
      (await call("POST", "/articles/x/publish", { body: { publish_on_approval: true } }))
        .statusCode,
    ).toBe(200);
    expect(service.publish.mock.calls.at(-1)?.[3]).toEqual({ publish_on_approval: true });
    expect(
      (
        await call("POST", "/articles/x/schedule", {
          body: { scheduled_at: "2027-01-01T07:00:00Z" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("POST", "/articles/x/unpublish", { body: {} })).statusCode).toBe(200);
    expect((await call("DELETE", "/articles/x?redirect_to=/blog/other")).statusCode).toBe(200);
    expect(service.remove.mock.calls.at(-1)?.[3]).toBe("/blog/other");
    expect((await call("GET", "/articles/x/revisions")).statusCode).toBe(200);
  });

  it("publish and schedule demand the content:publish scope; a key without it gets SCOPE_REQUIRED", async () => {
    principal.scopes = ["content:read", "content:write"];
    const publish = await call("POST", "/articles/x/publish", { body: {} });
    expect(publish.statusCode).toBe(403);
    expect(publish.json()).toMatchObject({ code: "SCOPE_REQUIRED" });
    expect(
      (
        await call("POST", "/articles/x/schedule", {
          body: { scheduled_at: "2027-01-01T07:00:00Z" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await call("POST", "/articles/x/unpublish", { body: {} })).statusCode).toBe(403);
  });

  it("an invalid schedule body or delete query is a 400", async () => {
    principal.scopes = ["content:read", "content:write", "content:publish"];
    expect(
      (await call("POST", "/articles/x/schedule", { body: { scheduled_at: "tomorrow" } }))
        .statusCode,
    ).toBe(400);
    expect((await call("DELETE", "/articles/x?redirect_to=https://evil.example")).statusCode).toBe(
      400,
    );
  });
});
