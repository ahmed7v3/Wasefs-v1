import { createHash } from "node:crypto";

import { createDb, files, onboardingProgress, seedDefaults } from "@wasfa/db";
import { HANDOFF_MAX_FILES, HANDOFF_TTL_SECONDS } from "@wasfa/shared/schemas/handoff";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";

import { AuthHarness, WEB, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { startStorage, type TestStorage } from "./support/storage.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/*
 * The desktop to phone handoff against real Postgres, Redis and MinIO: what a token may do (add up
 * to four pages to one user's capture session), what it may not (anything else), and who may watch
 * the live feed.
 */

const network = setupServer(...pwnedHandlers());

let infra: TestInfra;
let storage: TestStorage;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let redis: Redis;
let baseUrl: string;
/** Every live feed the suite opened, so teardown can end them whatever a test did. */
const feeds = new Set<AbortController>();
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  [infra, storage] = await Promise.all([startInfra(), startStorage()]);
  network.listen({ onUnhandledRequest: "bypass" });
  owner = createDb({ url: infra.databaseUrl, max: 4 });
  await seedDefaults(owner.db);
  app = await createApp(testApiEnv(infra, storage.env), {
    extraImports: [harness.mailerModule()],
    authMailer: false,
  });
  // The live feed is a long-lived response; `inject` cannot read it, so this suite also listens.
  await app.listen(0, "127.0.0.1");
  baseUrl = await app.getUrl();
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
}, 240_000);

afterAll(async () => {
  // Open feeds first: a response that never ends would keep the app from closing.
  for (const controller of feeds) controller.abort();
  network.close();
  await redis?.quit();
  await app?.close();
  await owner?.close();
  await storage?.stop();
  await infra?.stop();
});

interface Person {
  jar: Jar;
  userId: string;
}

async function user(): Promise<Person> {
  const person = await harness.signedInUser();
  await owner.db
    .insert(onboardingProgress)
    .values({ userId: person.userId, currentStep: "done", completedAt: new Date() });
  return person;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const jpegLike = (fill = 7) => Buffer.alloc(2048, fill);

function declare(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    purpose: "rx_page",
    mime: "image/jpeg",
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    width: 1200,
    height: 1600,
    ...overrides,
  };
}

interface Handoff {
  token: string;
  url: string;
  expiresAt: string;
}

async function startHandoff(person: Person, captureSessionId = crypto.randomUUID()) {
  const res = await harness.call("POST", "/handoff", {
    jar: person.jar,
    body: { captureSessionId },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { captureSessionId, handoff: res.json<Handoff>() };
}

const phoneUpload = (token: string, body: Record<string, unknown>) =>
  harness.call("POST", `/handoff/${token}/uploads`, { body, origin: null });
const phoneComplete = (token: string, fileId: string) =>
  harness.call("POST", `/handoff/${token}/uploads/${fileId}/complete`, { origin: null });

interface Created {
  fileId: string;
  url: string;
  headers: Record<string, string>;
}

/** What the phone does for one page: ask, PUT to storage, complete. */
/** The step `uploadPage` is in, so a feed that times out can say where the phone stopped. */
let uploadStep = "not started";

async function uploadPage(token: string, fill: number): Promise<Created> {
  const bytes = jpegLike(fill);
  uploadStep = `page ${fill}: upload request`;
  const created = await phoneUpload(token, declare(bytes));
  expect(created.statusCode, created.body).toBe(201);
  const body = created.json<Created>();
  uploadStep = `page ${fill}: PUT to storage`;
  const put = await fetch(body.url, {
    method: "PUT",
    headers: body.headers,
    body: new Uint8Array(bytes),
  });
  expect(put.status).toBe(200);
  uploadStep = `page ${fill}: complete`;
  const done = await phoneComplete(token, body.fileId);
  expect(done.statusCode, done.body).toBe(200);
  uploadStep = `page ${fill}: done`;
  return body;
}

function cookieHeader(jar: Jar): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Rejects with the step's name when `work` does not settle in `ms`. */
async function within<T>(step: () => string, ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${step()} did not finish in ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the live feed until `count` events arrived (or the wait ran out). */
async function readEvents(
  captureSessionId: string,
  jar: Jar,
  count: number,
  trigger: () => Promise<void>,
  waitMs = 15_000,
): Promise<string[]> {
  const controller = new AbortController();
  feeds.add(controller);
  // Armed before the first await, so no step below can outlive the wait.
  const started = Date.now();
  const events: string[] = [];
  const timer = setTimeout(() => controller.abort(), waitMs);
  try {
    const res = await fetch(`${baseUrl}/handoff/${captureSessionId}/events`, {
      headers: { cookie: cookieHeader(jar), origin: WEB },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let buffer = "";
    // The stream sends its greeting before the fetch resolves, so the subscription is already live.
    const left = Math.max(1, waitMs - (Date.now() - started));
    await within(() => `the uploads (at ${uploadStep})`, left, trigger());
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Only whole lines count: a chunk may end in the middle of one.
      const end = buffer.lastIndexOf("\n");
      for (const line of buffer.slice(0, end + 1).split("\n")) {
        if (line.startsWith("data: ")) events.push(line.slice("data: ".length));
      }
      buffer = buffer.slice(end + 1);
    }
    return events;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `the live feed gave no answer within ${waitMs} ms (${events.length} of ${count} events; uploads at ${uploadStep})`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    feeds.delete(controller);
  }
}

async function row(fileId: string) {
  const [found] = await owner.db.select().from(files).where(eq(files.id, fileId));
  if (!found) throw new Error("no such file row");
  return found;
}

describe("POST /handoff", () => {
  it("needs a session and a verified, onboarded account", async () => {
    const anonymous = await harness.call("POST", "/handoff", {
      body: { captureSessionId: crypto.randomUUID() },
    });
    expect(anonymous.statusCode).toBe(401);

    const fresh = await harness.signedInUser();
    const refused = await harness.call("POST", "/handoff", {
      jar: fresh.jar,
      body: { captureSessionId: crypto.randomUUID() },
    });
    expect(refused.statusCode).toBe(403);
  });

  it("rejects a session id that is not a UUID", async () => {
    const person = await user();
    const res = await harness.call("POST", "/handoff", {
      jar: person.jar,
      body: { captureSessionId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns a 5 minute link to the page the request came from, and keeps only the token hash", async () => {
    const person = await user();
    const { handoff } = await startHandoff(person);

    expect(handoff.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handoff.url).toBe(`${WEB}/capture/${handoff.token}`);
    const seconds = (new Date(handoff.expiresAt).getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(HANDOFF_TTL_SECONDS - 5);
    expect(seconds).toBeLessThanOrEqual(HANDOFF_TTL_SECONDS);

    const hash = createHash("sha256").update(handoff.token).digest("hex");
    expect(await redis.exists(`handoff:t:${hash}`)).toBe(1);
    // The token itself is nowhere in Redis, in a key or a value.
    for (const key of await redis.keys("handoff:*")) {
      expect(key).not.toContain(handoff.token);
    }
  });

  it("hides a session another user already uses", async () => {
    const [alice, mallory] = [await user(), await user()];
    const { captureSessionId } = await startHandoff(alice);
    const res = await harness.call("POST", "/handoff", {
      jar: mallory.jar,
      body: { captureSessionId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("the phone side", () => {
  it("adds pages that belong to the token's user, and only up to four", async () => {
    const person = await user();
    const { handoff } = await startHandoff(person);

    const status = await harness.call("GET", `/handoff/${handoff.token}`, { origin: null });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ remaining: HANDOFF_MAX_FILES });

    const first = await uploadPage(handoff.token, 1);
    expect(await row(first.fileId)).toMatchObject({
      ownerUserId: person.userId,
      createdBy: person.userId,
      purpose: "rx_page",
      status: "uploaded",
    });
    for (const fill of [2, 3, 4]) await uploadPage(handoff.token, fill);

    const fifth = await phoneUpload(handoff.token, declare(jpegLike(5)));
    expect(fifth.statusCode).toBe(409);
    expect(fifth.json()).toMatchObject({ code: "CONFLICT", details: { reason: "handoff_full" } });

    const after = await harness.call("GET", `/handoff/${handoff.token}`, { origin: null });
    expect(after.json()).toMatchObject({ remaining: 0 });
  });

  it("gives a page back when the upload could not be created", async () => {
    const person = await user();
    const { handoff } = await startHandoff(person);
    const heic = await phoneUpload(handoff.token, declare(jpegLike(), { mime: "image/heic" }));
    expect(heic.statusCode).toBe(422);
    const status = await harness.call("GET", `/handoff/${handoff.token}`, { origin: null });
    expect(status.json()).toMatchObject({ remaining: HANDOFF_MAX_FILES });
  });

  it("takes prescription pages only", async () => {
    const { handoff } = await startHandoff(await user());
    const res = await phoneUpload(handoff.token, declare(jpegLike(), { purpose: "chat_image" }));
    expect(res.statusCode).toBe(400);
  });

  it("stops working when the token expires, and for a token that never existed", async () => {
    const { handoff } = await startHandoff(await user());
    const hash = createHash("sha256").update(handoff.token).digest("hex");
    await redis.del(`handoff:t:${hash}`);

    for (const res of [
      await harness.call("GET", `/handoff/${handoff.token}`, { origin: null }),
      await phoneUpload(handoff.token, declare(jpegLike())),
      await phoneComplete(handoff.token, crypto.randomUUID()),
      await harness.call("GET", `/handoff/${"A".repeat(43)}`, { origin: null }),
    ]) {
      expect(res.statusCode).toBe(404);
    }
  });

  it("completes only files its own token created", async () => {
    const [alice, bob] = [await user(), await user()];
    const { handoff: aliceToken } = await startHandoff(alice);
    const { handoff: bobToken } = await startHandoff(bob);
    const page = await phoneUpload(bobToken.token, declare(jpegLike()));
    const { fileId } = page.json<Created>();

    // Alice's token knows nothing of Bob's file, and Bob's token is not Alice's.
    expect((await phoneComplete(aliceToken.token, fileId)).statusCode).toBe(404);
    expect((await row(fileId)).status).toBe("pending");
  });

  it("is not a session: it opens no other route and cannot start an analysis", async () => {
    const person = await user();
    const { handoff } = await startHandoff(person);
    const asHeaders = [
      { authorization: `Bearer ${handoff.token}` },
      { cookie: `better-auth.session_token=${handoff.token}` },
      { "x-handoff-token": handoff.token },
    ];
    for (const headers of asHeaders) {
      for (const [method, url] of [
        ["POST", "/uploads"],
        ["GET", "/me/credits"],
        ["GET", "/me"],
      ] as const) {
        const res = await harness.call(method, url, {
          headers,
          origin: null,
          ...(method === "POST" ? { body: declare(jpegLike()) } : {}),
        });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
      // `POST /rx` is built in parallel: until it exists the route answers 404, after it 401.
      const rx = await harness.call("POST", "/rx", {
        headers,
        origin: null,
        body: { fileIds: [crypto.randomUUID()], mode: "standard" },
      });
      expect([401, 404]).toContain(rx.statusCode);
    }
  });
});

describe("GET /handoff/:captureSessionId/events", () => {
  it("needs a session", async () => {
    const res = await harness.call("GET", `/handoff/${crypto.randomUUID()}/events`);
    expect(res.statusCode).toBe(401);
  });

  it("is a 404 for another user and for a session nobody opened", async () => {
    const [alice, mallory] = [await user(), await user()];
    const { captureSessionId } = await startHandoff(alice);

    const other = await harness.call("GET", `/handoff/${captureSessionId}/events`, {
      jar: mallory.jar,
    });
    expect(other.statusCode).toBe(404);
    const unknown = await harness.call("GET", `/handoff/${crypto.randomUUID()}/events`, {
      jar: alice.jar,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("tells the desktop about every page the phone finishes, and only that desktop", async () => {
    // Timings per phase: this test stalled on CI with no step named; the log shows where.
    const t0 = Date.now();
    const mark = (phase: string) =>
      process.stderr.write(`[handoff-sse] ${phase} +${Date.now() - t0} ms\n`);
    const [alice, mallory] = [await user(), await user()];
    mark("users");
    const { captureSessionId, handoff } = await startHandoff(alice);
    // Mallory has a session of her own; Alice's pages must not reach it.
    const { captureSessionId: malloryTab } = await startHandoff(mallory);
    mark("handoffs");

    const seen: string[] = [];
    const bystander = readEvents(malloryTab, mallory.jar, 1, async () => undefined, 4_000).catch(
      () => [] as string[],
    );
    const events = await readEvents(captureSessionId, alice.jar, 2, async () => {
      seen.push((await uploadPage(handoff.token, 1)).fileId);
      seen.push((await uploadPage(handoff.token, 2)).fileId);
      mark("uploads");
    });
    mark("events");

    expect(events.map((line) => (JSON.parse(line) as { fileId: string }).fileId)).toEqual(seen);
    expect(await bystander).toEqual([]);
    mark("bystander");
    // Above the feed's own 15 s deadline, so a stall fails with the step's name, not vitest's.
  }, 60_000);
});
