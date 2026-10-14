import { t } from "@wasfa/shared/i18n";
import { CaptureError, type PreparedImage } from "@wasfa/ui";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../src/lib/api-error";
import {
  UploadNetworkError,
  UploadRefusedError,
  createUploadQueue,
  isRetryable,
  waitUntilProcessed,
  type UploadTransport,
} from "../src/lib/capture/upload-queue";

const FILE = "6f1c2c0e-8f1a-4c0e-9d57-0a1f3a3b9a11";

function page(): PreparedImage {
  return {
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    width: 1600,
    height: 1200,
    sha256: "a".repeat(64),
    issues: [],
  };
}

function transport(overrides: Partial<UploadTransport> = {}): UploadTransport {
  return {
    create: vi.fn().mockResolvedValue({
      fileId: FILE,
      url: "https://storage.example/put",
      headers: { "content-type": "image/jpeg" },
      expiresInSeconds: 300,
    }),
    put: vi.fn().mockImplementation(async (_target, _body, { onProgress }) => {
      onProgress(0.5);
      onProgress(1);
    }),
    complete: vi.fn().mockResolvedValue({ fileId: FILE, status: "uploaded" }),
    status: vi.fn().mockResolvedValue({ fileId: FILE, status: "processed", rejectReason: null }),
    ...overrides,
  };
}

/** A sleep that records the requested delays and returns at once. */
function fastSleep() {
  const delays: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { delays, sleep };
}

const options = (signal = new AbortController().signal) => ({ signal, onProgress: vi.fn() });

describe("upload queue", () => {
  it("creates, puts, completes and waits until the page is processed", async () => {
    const calls = transport({
      status: vi
        .fn()
        .mockResolvedValueOnce({ fileId: FILE, status: "uploaded", rejectReason: null })
        .mockResolvedValueOnce({ fileId: FILE, status: "processed", rejectReason: null }),
    });
    const { sleep } = fastSleep();
    const queue = createUploadQueue(calls, { sleep });
    const progress = options();
    await expect(queue.upload(page(), progress)).resolves.toEqual({ fileId: FILE });

    expect(calls.create).toHaveBeenCalledWith(
      { mime: "image/jpeg", bytes: 4, sha256: "a".repeat(64), width: 1600, height: 1200 },
      expect.any(AbortSignal),
    );
    expect(progress.onProgress).toHaveBeenCalledWith(0.5);
    expect(progress.onProgress).toHaveBeenLastCalledWith(1);
    expect(calls.status).toHaveBeenCalledTimes(2);
  });

  it("is done after complete when there is no status route (the phone)", async () => {
    const calls = transport();
    delete calls.status;
    await expect(createUploadQueue(calls).upload(page(), options())).resolves.toEqual({
      fileId: FILE,
    });
  });

  it("retries a network failure with 1, 2 and 4 second backoff, then succeeds", async () => {
    const put = vi
      .fn()
      .mockRejectedValueOnce(new UploadNetworkError())
      .mockRejectedValueOnce(new UploadNetworkError())
      .mockRejectedValueOnce(new UploadNetworkError())
      .mockResolvedValueOnce(undefined);
    const { delays, sleep } = fastSleep();
    const calls = transport({ put });
    await createUploadQueue(calls, { sleep }).upload(page(), options());
    expect(put).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1000, 2000, 4000]);
    // The presigned URL is reused: create ran once.
    expect(calls.create).toHaveBeenCalledTimes(1);
  });

  it("gives up after three retries with a readable error", async () => {
    const put = vi.fn().mockRejectedValue(new UploadNetworkError());
    const { sleep } = fastSleep();
    const failure = createUploadQueue(transport({ put }), { sleep }).upload(page(), options());
    await expect(failure).rejects.toBeInstanceOf(CaptureError);
    await expect(failure).rejects.toMatchObject({ message: t("capture.error.generic") });
    expect(put).toHaveBeenCalledTimes(4);
  });

  it("retries a 5xx or no-response API failure, but not a 4xx", async () => {
    const { sleep } = fastSleep();
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError("INTERNAL", "x", undefined, 503))
      .mockRejectedValueOnce(new ApiRequestError("UPSTREAM_UNAVAILABLE", "x"))
      .mockResolvedValue({
        fileId: FILE,
        url: "https://s.example/",
        headers: {},
        expiresInSeconds: 1,
      });
    await createUploadQueue(transport({ create: flaky }), { sleep }).upload(page(), options());
    expect(flaky).toHaveBeenCalledTimes(3);

    const refused = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("RATE_LIMITED", "حاول لاحقًا", "WSF-ABCD-2345", 429));
    const failure = createUploadQueue(transport({ create: refused }), { sleep }).upload(
      page(),
      options(),
    );
    await expect(failure).rejects.toMatchObject({ message: "حاول لاحقًا", ref: "WSF-ABCD-2345" });
    expect(refused).toHaveBeenCalledTimes(1);

    const expired = vi.fn().mockRejectedValue(new UploadRefusedError(403));
    await expect(
      createUploadQueue(transport({ put: expired }), { sleep }).upload(page(), options()),
    ).rejects.toBeInstanceOf(CaptureError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("says why a page was rejected", async () => {
    const calls = transport({
      status: vi
        .fn()
        .mockResolvedValue({ fileId: FILE, status: "rejected", rejectReason: "corrupt_image" }),
    });
    await expect(createUploadQueue(calls).upload(page(), options())).rejects.toMatchObject({
      message: t("capture.error.reason.corrupt_image"),
    });
  });

  it("uploads two pages at a time and starts the next as one finishes", async () => {
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const put = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          running += 1;
          peak = Math.max(peak, running);
          releases.push(() => {
            running -= 1;
            resolve();
          });
        }),
    );
    const calls = transport({ put });
    delete calls.status;
    const queue = createUploadQueue(calls);
    const all = [1, 2, 3].map(() => queue.upload(page(), options()));

    await vi.waitFor(() => {
      expect(put).toHaveBeenCalledTimes(2);
    });
    expect(peak).toBe(2);
    releases[0]?.();
    await vi.waitFor(() => {
      expect(put).toHaveBeenCalledTimes(3);
    });
    expect(peak).toBe(2);
    releases[1]?.();
    releases[2]?.();
    await Promise.all(all);
  });

  it("cancels a transfer in flight and never completes it", async () => {
    const controller = new AbortController();
    const put = vi.fn().mockImplementation(
      (_target, _body, { signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const calls = transport({ put });
    const upload = createUploadQueue(calls).upload(page(), options(controller.signal));
    await vi.waitFor(() => {
      expect(put).toHaveBeenCalled();
    });
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.complete).not.toHaveBeenCalled();
  });

  it("cancels a page that is still waiting for a free slot", async () => {
    const hold = new Promise<void>(() => undefined);
    const calls = transport({ put: vi.fn().mockReturnValue(hold) });
    const queue = createUploadQueue(calls, { concurrency: 1 });
    void queue.upload(page(), options());
    const controller = new AbortController();
    const waiting = queue.upload(page(), options(controller.signal));
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.create).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when cancelled during the backoff", async () => {
    const controller = new AbortController();
    const put = vi.fn().mockRejectedValue(new UploadNetworkError());
    const queue = createUploadQueue(transport({ put }), {
      sleep: () => {
        controller.abort();
        return Promise.reject(new DOMException("aborted", "AbortError"));
      },
    });
    await expect(queue.upload(page(), options(controller.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("times out when the worker never finishes the page", async () => {
    const calls = transport({
      status: vi.fn().mockResolvedValue({ fileId: FILE, status: "uploaded", rejectReason: null }),
    });
    const { sleep } = fastSleep();
    await expect(
      createUploadQueue(calls, { sleep, pollTimeoutMs: 0 }).upload(page(), options()),
    ).rejects.toBeInstanceOf(CaptureError);
  });
});

describe("waitUntilProcessed", () => {
  it("polls until processed and retries a flaky status call", async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(new ApiRequestError("UPSTREAM_UNAVAILABLE", "x"))
      .mockResolvedValueOnce({ fileId: FILE, status: "uploaded", rejectReason: null })
      .mockResolvedValueOnce({ fileId: FILE, status: "processed", rejectReason: null });
    const { delays, sleep } = fastSleep();
    await waitUntilProcessed(check, FILE, new AbortController().signal, { sleep });
    expect(check).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 1000]);
  });
});

describe("isRetryable", () => {
  it("is true for the network and 5xx only", () => {
    expect(isRetryable(new UploadNetworkError())).toBe(true);
    expect(isRetryable(new ApiRequestError("INTERNAL", "x", undefined, 500))).toBe(true);
    expect(isRetryable(new ApiRequestError("UPSTREAM_UNAVAILABLE", "x"))).toBe(true);
    expect(isRetryable(new ApiRequestError("NOT_FOUND", "x", undefined, 404))).toBe(false);
    expect(isRetryable(new UploadRefusedError(403))).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(false);
  });
});
