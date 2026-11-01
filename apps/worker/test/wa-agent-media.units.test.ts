import { afterEach, describe, expect, it, vi } from "vitest";

import { ingestMedia, type AgentContent, type MediaIo } from "../src/wa-bridge/agent-media.js";

import type { RawMessage } from "../src/wa-bridge/inbound.js";

/* Every typed reason of ingestMedia, driven by a fake download / re-upload / bucket. */

const NOW = 1_800_000_000_000;
const RAW: RawMessage = {
  key: { id: "MSG1", remoteJid: "201012345678@s.whatsapp.net", fromMe: false },
  message: null,
  messageTimestamp: Math.floor(NOW / 1000),
  pushName: "Mona",
};

type Media = Extract<AgentContent, { kind: "image" | "document" | "audio" }>;
const media = (kind: Media["kind"], mime: string | null, bytes: number | null = 2_000): Media => ({
  kind,
  text: null,
  mime,
  bytes,
  seconds: null,
});

const body = (size = 2_000) => Buffer.alloc(size, 1);
const gone = () => Object.assign(new Error("not found"), { status: 404 });

function io(overrides: Partial<MediaIo> = {}): MediaIo {
  return {
    download: () => Promise.resolve(body()),
    put: () => Promise.resolve(),
    ...overrides,
  };
}

async function run(content: Media, mediaIo: MediaIo | null) {
  vi.useFakeTimers();
  const pending = ingestMedia(content, RAW, mediaIo, NOW);
  await vi.advanceTimersByTimeAsync(120_000);
  return pending;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ingestMedia reasons", () => {
  it("ok: stored with media and status ok", async () => {
    const result = await run(media("image", "image/png"), io());
    expect(result).toMatchObject({ kind: "image", mediaStatus: "ok" });
    expect(result.media?.key).toMatch(/^wa\//);
  });

  it("an image sent as a document is stored as kind image", async () => {
    const result = await run(media("document", "image/heif"), io());
    expect(result.kind).toBe("image");
  });

  it("too_large: declared size over the limit keeps the kind, no media, no download", async () => {
    const download = vi.fn(() => Promise.resolve(body()));
    const result = await run(
      media("document", "application/pdf", 11 * 1024 * 1024),
      io({ download }),
    );
    expect(result).toEqual({ kind: "document", mediaStatus: "too_large" });
    expect(download).not.toHaveBeenCalled();
  });

  it("too_large: the downloaded size is checked too", async () => {
    const big = body(11 * 1024 * 1024);
    const result = await run(
      media("image", "image/jpeg", null),
      io({ download: () => Promise.resolve(big) }),
    );
    expect(result).toEqual({ kind: "image", mediaStatus: "too_large" });
  });

  it("unsupported_type: a mime the agent cannot read keeps the kind", async () => {
    expect(await run(media("document", "application/zip"), io())).toEqual({
      kind: "document",
      mediaStatus: "unsupported_type",
    });
    expect(await run(media("image", null), io())).toEqual({
      kind: "image",
      mediaStatus: "unsupported_type",
    });
  });

  it("storage_unavailable: no bucket configured, or the put fails", async () => {
    expect(await run(media("image", "image/jpeg"), null)).toEqual({
      kind: "image",
      mediaStatus: "storage_unavailable",
    });
    const failing = io({ put: () => Promise.reject(new Error("r2 down")) });
    expect(await run(media("audio", "audio/ogg"), failing)).toEqual({
      kind: "audio",
      mediaStatus: "storage_unavailable",
    });
  });

  it("download_failed: an empty body, and errors after all retries", async () => {
    const empty = io({ download: () => Promise.resolve(Buffer.alloc(0)) });
    expect((await run(media("image", "image/jpeg"), empty)).mediaStatus).toBe("download_failed");
    const download = vi.fn(() => Promise.reject(new Error("socket closed")));
    const result = await run(media("image", "image/jpeg"), io({ download }));
    expect(result.mediaStatus).toBe("download_failed");
    expect(download).toHaveBeenCalledTimes(3);
  });

  it("retries once and succeeds", async () => {
    let calls = 0;
    const download = () =>
      ++calls === 1 ? Promise.reject(new Error("reset")) : Promise.resolve(body());
    expect((await run(media("image", "image/jpeg"), io({ download }))).mediaStatus).toBe("ok");
    expect(calls).toBe(2);
  });

  it("a 404 asks for one re-upload, then downloads from the fresh message", async () => {
    const fresh: RawMessage = { ...RAW, pushName: "fresh" };
    const seen: Array<string | null | undefined> = [];
    const download = (raw: RawMessage) => {
      seen.push(raw.pushName);
      return raw.pushName === "fresh" ? Promise.resolve(body()) : Promise.reject(gone());
    };
    const reupload = vi.fn(() => Promise.resolve(fresh));
    const result = await run(media("image", "image/jpeg"), io({ download, reupload }));
    expect(result.mediaStatus).toBe("ok");
    expect(reupload).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Mona", "fresh"]);
  });

  it("expired: re-upload fails after a 404", async () => {
    const reupload = vi.fn(() => Promise.reject(new Error("phone offline")));
    const download = () => Promise.reject(gone());
    const result = await run(media("image", "image/jpeg"), io({ download, reupload }));
    expect(result).toEqual({ kind: "image", mediaStatus: "expired" });
    expect(reupload).toHaveBeenCalledTimes(1);
  });
});
