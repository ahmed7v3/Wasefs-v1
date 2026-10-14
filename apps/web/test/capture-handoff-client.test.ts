import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHandoffClient } from "../src/lib/capture/handoff-client";

const SESSION = "0b0f3b0e-5c1e-4a53-9d0b-2f4d3e0f9a10";
const FILE = "6f1c2c0e-8f1a-4c0e-9d57-0a1f3a3b9a11";

class FakeEventSource {
  static last: FakeEventSource | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.last = this;
  }
  close(): void {
    this.closed = true;
  }
  emit(data: string): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handoff client", () => {
  it("asks the API for a link for this capture session", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "A".repeat(43),
          url: `https://wasfa.online/capture/${"A".repeat(43)}`,
          expiresAt: "2026-10-14T12:05:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const session = await createHandoffClient().start(SESSION);
    expect(session).toEqual({
      url: `https://wasfa.online/capture/${"A".repeat(43)}`,
      expiresAt: "2026-10-14T12:05:00.000Z",
    });
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toMatch(/\/handoff$/);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ captureSessionId: SESSION });
  });

  it("listens to the session's feed with the cookie and reports only well-formed pages", () => {
    const seen: string[] = [];
    const stop = createHandoffClient().subscribe(SESSION, (fileId) => seen.push(fileId));
    const source = FakeEventSource.last;
    expect(source?.url).toMatch(new RegExp(`/handoff/${SESSION}/events$`));
    expect(source?.init?.withCredentials).toBe(true);

    source?.emit("not json");
    source?.emit(JSON.stringify({ fileId: "nope" }));
    source?.emit(JSON.stringify({ fileId: FILE }));
    expect(seen).toEqual([FILE]);

    stop();
    expect(source?.closed).toBe(true);
  });

  it("draws the link as a QR data URL", async () => {
    const src = await createHandoffClient().qr("https://wasfa.online/capture/x");
    expect(src).toMatch(/^data:image\/svg\+xml/);
  });
});
