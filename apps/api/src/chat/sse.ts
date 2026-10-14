import { CHAT_HEARTBEAT_MS, type ChatEvent } from "@wasfa/shared/schemas/chat";

import type { ErrorCode } from "@wasfa/shared/errors";

/** The slice of Node's `ServerResponse` the stream needs (and a fake in the unit test). */
export interface SseTarget {
  writeHead(status: number, headers: Record<string, string | number | string[]>): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  readonly writableEnded: boolean;
  readonly destroyed: boolean;
}

/**
 * What the chat turn needs from the HTTP layer. The service stays free of Fastify: it opens the
 * stream once it is committed to answering (until then errors are plain JSON), sends events, and
 * learns about a closed connection through `signal`.
 */
export interface ChatStreamIo {
  /** Commits to a stream: writes the headers and starts the heartbeat. Idempotent. */
  open(): void;
  send(event: ChatEvent): void;
  /** Ends the response and stops the heartbeat. Idempotent. */
  close(): void;
  /** Aborted when the client goes away before `close`. */
  readonly signal: AbortSignal;
  /** Stores an unexpected error (`error_events`) and returns its `WSF-` reference. */
  report(error: unknown, code: ErrorCode): Promise<string>;
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  // `no-transform` keeps proxies from compressing (= buffering) the stream.
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Tells nginx-style proxies not to buffer; Caddy gets `flush_interval -1` for the same reason.
  "x-accel-buffering": "no",
} as const;

/** One SSE frame: `event:` name and a single-line JSON `data:`. */
export function formatEvent(event: ChatEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Writes SSE frames to a response and keeps it alive with a heartbeat. Writes after the client left
 * or after `end()` are dropped silently: the turn must finish its bookkeeping either way.
 */
export class SseStream {
  private timer: NodeJS.Timeout | undefined;
  private opened = false;

  constructor(
    private readonly target: SseTarget,
    private readonly heartbeatMs: number = CHAT_HEARTBEAT_MS,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  start(extraHeaders: Record<string, string | number | string[]> = {}): void {
    if (this.opened) return;
    this.opened = true;
    this.target.writeHead(200, { ...extraHeaders, ...SSE_HEADERS });
    this.timer = setInterval(() => {
      this.send({ event: "heartbeat", data: {} });
    }, this.heartbeatMs);
    // A pending heartbeat must never keep the process alive.
    this.timer.unref();
  }

  send(event: ChatEvent): void {
    if (!this.opened || this.target.writableEnded || this.target.destroyed) return;
    this.target.write(formatEvent(event));
  }

  end(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    if (this.opened && !this.target.writableEnded && !this.target.destroyed) this.target.end();
  }
}
