import {
  REVALIDATE_HEADER,
  ReplayCache,
  verifyRevalidation,
} from "@wasfa/shared/content/revalidate";
import { REVALIDATE_WINDOW_SECONDS, revalidateRequestSchema } from "@wasfa/shared/schemas/content";
import { revalidateTag } from "next/cache";

import { serverEnv } from "../../../lib/server-env";

/*
 * Cache revalidation for published content (CONTENT-PLATFORM §11.5): the worker POSTs the tags that
 * changed, signed with HMAC-SHA256 over "<timestamp>.<raw body>". Server to server only: no cookies,
 * no CSRF token, no Origin header. The body is never echoed back; every failure is a bare status.
 */

// Signatures stay single-use for the whole window (a replay inside it is refused with 409).
const replays = new ReplayCache();

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
let windowStart = 0;
let windowCount = 0;

function overRateLimit(nowMs: number): boolean {
  if (nowMs - windowStart >= RATE_WINDOW_MS) {
    windowStart = nowMs;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount > RATE_LIMIT;
}

function status(code: number): Response {
  return new Response(null, { status: code });
}

export async function POST(request: Request): Promise<Response> {
  const secret = serverEnv.REVALIDATE_SECRET;
  // Not configured (dev): behave as if the route does not exist.
  if (secret === undefined) return status(404);

  const nowMs = Date.now();
  if (overRateLimit(nowMs)) return status(429);

  const raw = await request.text();
  const signature = request.headers.get(REVALIDATE_HEADER) ?? "";
  let timestamp = Number.NaN;
  try {
    const candidate = (JSON.parse(raw) as { timestamp?: unknown } | null)?.timestamp;
    if (typeof candidate === "number") timestamp = candidate;
  } catch {
    // Unparseable: verification below answers 401, the same as any other unauthenticated call.
  }
  const check = verifyRevalidation({
    secret,
    signature,
    timestamp,
    body: raw,
    now: Math.floor(nowMs / 1000),
    windowSeconds: REVALIDATE_WINDOW_SECONDS,
  });
  if (!check.ok) return status(401);
  if (!replays.remember(signature, nowMs, REVALIDATE_WINDOW_SECONDS * 2 * 1000)) return status(409);

  const parsed = revalidateRequestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return status(400);

  for (const tag of parsed.data.tags) revalidateTag(tag, "max");
  return Response.json({ revalidated: parsed.data.tags.length });
}
