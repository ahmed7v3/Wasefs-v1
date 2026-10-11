import { HttpResponse } from "msw";

import type { NormalizedEvent, NormalizedRequest } from "../src/index.js";

export const enc = new TextEncoder();

export function request(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    model: "test-model",
    messages: [{ role: "user", parts: [{ type: "text", text: "hello there" }] }],
    maxOutputTokens: 256,
    ...overrides,
  };
}

export async function collect(
  iterable: AsyncIterable<NormalizedEvent>,
): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

/** Collects events until the iterable ends or throws; returns both. */
export async function collectUntilError(
  iterable: AsyncIterable<NormalizedEvent>,
): Promise<{ events: NormalizedEvent[]; error: unknown }> {
  const events: NormalizedEvent[] = [];
  try {
    for await (const event of iterable) events.push(event);
  } catch (error) {
    return { events, error };
  }
  return { events, error: undefined };
}

/** An SSE response whose frames are the given raw strings, each ended by a blank line. */
export function sseResponse(frames: string[]): Response {
  return new HttpResponse(enc.encode(frames.map((frame) => `data: ${frame}\n\n`).join("")), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** An SSE response that sends the given frames and then hangs until the client cancels. */
export function hangingSseResponse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(enc.encode(`data: ${frame}\n\n`));
    },
  });
  return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
}
