import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { rxChannel, rxLastEventKey, rxSeqKey, type RxEvent } from "@wasfa/shared/schemas/rx";

import { runtime, type StackUrls } from "./runtime";

import type { BrowserContext, Page } from "@playwright/test";
import type { Redis } from "ioredis";

/*
 * Seeds prescription analyses without a provider: the page image goes through the real upload
 * pipeline (MinIO and the worker), the analysis rows are inserted straight into Postgres with the
 * owner role, and progress events are published to Redis exactly as the worker would.
 */

const DB_DIR = fileURLToPath(new URL("../../../../packages/db/", import.meta.url));

/** A done result with a matched high line, a medium one, an unmatched low one, a finding and an unreadable region. */
export function sampleResult() {
  const line = (over: Record<string, unknown>) => ({
    rawText: "",
    name: null,
    matchedDrugId: null,
    matchScore: null,
    activeIngredients: [] as string[],
    strength: null,
    form: null,
    dose: null,
    frequency: null,
    duration: null,
    route: null,
    notes: null,
    confidence: 0.9,
    badge: "high",
    verified: "not_needed",
    box_2d: null,
    page: 0,
    ...over,
  });
  return {
    schemaVersion: 1,
    date: "2026-10-01",
    prescriberLegible: true,
    items: [
      line({
        rawText: "Augmentin 1g",
        name: "Augmentin",
        matchedDrugId: "00000000-0000-4000-8000-0000000000a1",
        matchScore: 0.95,
        activeIngredients: ["Amoxicillin"],
        strength: "1 g",
        form: "أقراص",
        frequency: "مرتين يوميًا",
        duration: "7 أيام",
        box_2d: [100, 100, 160, 600],
      }),
      line({
        rawText: "Amoxil 500",
        name: "Amoxil",
        matchedDrugId: "00000000-0000-4000-8000-0000000000a2",
        matchScore: 0.7,
        activeIngredients: ["Amoxicillin"],
        strength: "500 mg",
        confidence: 0.7,
        badge: "medium",
        box_2d: [200, 100, 260, 500],
      }),
      line({
        rawText: "Zyr?ec",
        name: "Zyr?ec",
        confidence: 0.4,
        badge: "low",
        box_2d: [300, 100, 360, 400],
      }),
    ],
    findings: [{ kind: "duplicate_ingredient", itemIndexes: [0, 1], ingredient: "Amoxicillin" }],
    unreadableRegions: [{ page: 0, box_2d: [600, 100, 660, 500] }],
  };
}

/** Draws a page of text in the browser and returns it as JPEG bytes. */
async function pageJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1600, 1200);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 40px monospace";
    for (let i = 0; i < 12; i += 1)
      ctx.fillText(`Rx ${String(i)} Augmentin 1g 1 x 2`, 100, 130 + i * 90);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.9);
    });
    if (!blob) throw new Error("no jpeg");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

/** Uploads one page through the real pipeline and waits until the worker processed it. */
export async function uploadRxPage(
  context: BrowserContext,
  page: Page,
  urls: StackUrls,
): Promise<string> {
  const bytes = await pageJpeg(page);
  const headers = { Origin: urls.web };
  const created = await context.request.post(`${urls.api}/uploads`, {
    headers,
    data: {
      purpose: "rx_page",
      mime: "image/jpeg",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  });
  if (!created.ok()) throw new Error(`upload create failed: ${String(created.status())}`);
  const slot = (await created.json()) as {
    fileId: string;
    url: string;
    headers: Record<string, string>;
  };
  const put = await fetch(slot.url, { method: "PUT", headers: slot.headers, body: new Uint8Array(bytes) });
  if (!put.ok) throw new Error(`upload PUT failed: ${String(put.status)}`);
  const done = await context.request.post(`${urls.api}/uploads/${slot.fileId}/complete`, {
    headers,
    data: {},
  });
  if (!done.ok()) throw new Error(`upload complete failed: ${String(done.status())}`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await context.request.get(`${urls.api}/files/${slot.fileId}`);
    const body = (await status.json()) as { status?: string };
    if (body.status === "processed") return slot.fileId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the page was not processed in time");
}

function sql(script: string, params: object): void {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: DB_DIR,
    env: { ...process.env, DATABASE_URL: runtime().ownerDatabaseUrl, P: JSON.stringify(params) },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`rx seed failed: ${result.stdout}${result.stderr}`);
}

export interface SeedOptions {
  email: string;
  fileIds: string[];
  status: "queued" | "processing" | "done" | "refunded" | "failed";
  result?: object | null;
  errorRef?: string | null;
}

/** Inserts an analysis owned by `email`; returns its id. */
export function seedAnalysis(options: SeedOptions): string {
  const id = randomUUID();
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
const [u] = await db\`select id from users where email = \${p.email}\`;
const ended = ["done", "refunded", "failed"].includes(p.status);
await db\`insert into rx_analyses (id, owner_user_id, created_by, status, mode, credits_charged, skill_version, result, started_at, finished_at, error_ref)
  values (\${p.id}, \${u.id}, \${u.id}, \${p.status}, 'balanced', 0, 'e2e', \${p.result ? db.json(p.result) : null}, now(), \${ended ? db\`now()\` : null}, \${p.errorRef})\`;
for (const [i, fileId] of p.fileIds.entries()) {
  await db\`insert into rx_pages (analysis_id, page_no, file_id) values (\${p.id}, \${i + 1}, \${fileId})\`;
}
await db.end();`,
    { id, ...options, result: options.result ?? null, errorRef: options.errorRef ?? null },
  );
  return id;
}

/** Ends a queued analysis the way the worker does: row first, then the event. */
export function finishAnalysis(
  id: string,
  status: "done" | "refunded" | "failed",
  result: object | null,
): void {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
await db\`update rx_analyses set status = \${p.status}, result = \${p.result ? db.json(p.result) : null}, finished_at = now() where id = \${p.id}\`;
await db.end();`,
    { id, status, result },
  );
}

/** Publishes a progress event on `rx:<id>` and keeps the "last event" the API replays to late clients. */
type RxEventBody = RxEvent extends infer E
  ? E extends { seq: number }
    ? Omit<E, "seq">
    : never
  : never;

export async function publishRxEvent(
  redis: Redis,
  id: string,
  event: RxEventBody,
): Promise<number> {
  const seq = await redis.incr(rxSeqKey(id));
  const full = JSON.stringify({ ...event, seq });
  await redis.set(rxLastEventKey(id), full, "EX", 3600);
  await redis.publish(rxChannel(id), full);
  return seq;
}
