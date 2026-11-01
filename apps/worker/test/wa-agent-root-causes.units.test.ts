import { afterEach, describe, expect, it, vi } from "vitest";

import { ingestMedia, type AgentContent, type MediaIo } from "../src/wa-bridge/agent-media.js";

import type { RawMessage } from "../src/wa-bridge/inbound.js";

/*
 * Bridge-side root causes of docs/WA-AGENT-RUNTIME.md §2, fixed in WP1: R2 (media that is usable is
 * stored as such, failures get a typed reason) and R15 (the download has a timeout and retries).
 * The decline cleanup of R16 lives in the api (`AgentRxService`), see its test file.
 */

const NOW = 1_800_000_000_000;
const RAW: RawMessage = {
  key: { id: "MSG1", remoteJid: "201012345678@s.whatsapp.net", fromMe: false },
  message: null,
  messageTimestamp: Math.floor(NOW / 1000),
  pushName: "Mona",
};

type Media = Extract<AgentContent, { kind: "image" | "document" | "audio" }>;
const media = (kind: Media["kind"], mime: string): Media => ({
  kind,
  text: null,
  mime,
  bytes: 2_000,
  seconds: null,
});

function io(overrides: Partial<MediaIo> = {}) {
  const stored: Array<{ key: string; contentType: string }> = [];
  const value: MediaIo = {
    download: () => Promise.resolve(Buffer.alloc(2_000, 1)),
    put: (key, _body, contentType) => {
      stored.push({ key, contentType });
      return Promise.resolve();
    },
    ...overrides,
  };
  return { io: value, stored };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("R2 media is stored as usable media", () => {
  it("a HEIC image is stored as an image", async () => {
    const result = await ingestMedia(media("image", "image/heic"), RAW, io().io, NOW);
    expect(result.kind, "R2: a HEIC image is kind image, not other").toBe("image");
    expect(result.media?.mime, "R2: the HEIC mime is kept").toBe("image/heic");
    expect(result.media?.key, "R2: the HEIC image has a media key").toMatch(/^wa\//);
  });

  it("a HEIF document is stored as usable media", async () => {
    const result = await ingestMedia(media("document", "image/heif"), RAW, io().io, NOW);
    expect(["image", "document"], "R2: a HEIF document is image or document, not other").toContain(
      result.kind,
    );
    expect(result.media?.mime, "R2: the HEIF mime is kept").toBe("image/heif");
    expect(result.media?.key, "R2: the HEIF document has a media key").toMatch(/^wa\//);
  });

  it("an image sent as a document is stored as usable media", async () => {
    const result = await ingestMedia(media("document", "image/jpeg"), RAW, io().io, NOW);
    expect(["image", "document"], "R2: a jpeg sent as a document is not other").toContain(
      result.kind,
    );
    expect(result.media?.mime, "R2: the jpeg mime is kept").toBe("image/jpeg");
    expect(result.media?.key, "R2: the jpeg document has a media key").toMatch(/^wa\//);
  });

  it("a failed download is stored with the typed reason download_failed", async () => {
    vi.useFakeTimers();
    const failing = io({ download: () => Promise.reject(new Error("socket closed")) });
    const pending = ingestMedia(media("image", "image/jpeg"), RAW, failing.io, NOW);
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await pending;
    expect(result.mediaStatus, "R2: a failed download carries mediaStatus download_failed").toBe(
      "download_failed",
    );
    expect(result.kind, "R2: the kind is kept").toBe("image");
  });

  // Already correct in v1 at the bridge (the tool never reads a PDF, which is the api side of R2):
  // kept as a guard so v2 does not regress it.
  it("a PDF document is stored as a document with its mime and a media key", async () => {
    const result = await ingestMedia(media("document", "application/pdf"), RAW, io().io, NOW);
    expect(result.kind).toBe("document");
    expect(result.media?.mime).toBe("application/pdf");
    expect(result.media?.key).toMatch(/^wa\//);
  });
});

describe("R15 media download timeout", () => {
  it("a download that never resolves is aborted at 30 s, retried, then stored as download_failed", async () => {
    vi.useFakeTimers();
    const attempts = { count: 0 };
    // Honours the abort signal when one is passed; with none it simply never answers.
    const hanging = io({
      download: ((_raw: RawMessage, signal?: AbortSignal) => {
        attempts.count += 1;
        return new Promise<Buffer>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      }) as MediaIo["download"],
    });
    const outcome: { value?: Record<string, unknown> } = {};
    void ingestMedia(media("image", "image/jpeg"), RAW, hanging.io, NOW).then((result) => {
      outcome.value = result as unknown as Record<string, unknown>;
    });
    // First attempt aborts at 30 s; the first retry starts after its 1 s pause.
    await vi.advanceTimersByTimeAsync(31_500);
    expect(attempts.count, "R15: download aborts after 30 s and is retried").toBeGreaterThanOrEqual(
      2,
    );
    // Two retries (1 s and 4 s pauses), each aborted at 30 s.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(
      outcome.value,
      "R15: ingest does not hang on a download that never resolves",
    ).toBeDefined();
    expect(outcome.value?.["mediaStatus"], "R15: the inbound carries reason download_failed").toBe(
      "download_failed",
    );
  });
});
