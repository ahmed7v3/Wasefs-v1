// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider, type CapturePage, type CaptureUploader } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeCapture } from "../src/components/capture/analyze-capture";
import { QuickCapture } from "../src/components/dashboard/quick-capture";
import {
  clearPendingCapture,
  peekPendingCapture,
  stashPendingCapture,
} from "../src/lib/capture/pending-capture";
import { useChatAttachments } from "../src/lib/use-chat-attachments";

/*
 * Task 2.12: a drop or paste on the dashboard uploads the pages and hands their ids to /analyze,
 * which shows them ready to analyze. The browser pipeline and the network are faked.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const uploaderMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../src/lib/capture/uploader", () => ({
  createCaptureUploader: () => uploaderMock.current,
}));
vi.mock("../src/lib/capture/handoff-client", () => ({
  createHandoffClient: () => ({
    start: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    qr: vi.fn(async () => undefined),
    adopt: vi.fn(async () => ({ previewUrl: "https://img.example/p.jpg" })),
  }),
}));

function fakeUploader(issues: Array<"blurry"> = []) {
  let next = 0;
  const prepare = vi.fn(async () => ({
    pages: [
      {
        blob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
        width: 1600,
        height: 1200,
        sha256: "0".repeat(64),
        issues,
      },
    ],
    trimmed: false,
  }));
  const upload = vi.fn(async () => ({ fileId: id((next += 1)) }));
  const uploader: CaptureUploader = { prepare, upload };
  uploaderMock.current = uploader;
  return { prepare, upload };
}

function paste(file: File) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [file], items: [], types: ["Files"] },
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

const picture = (name = "rx.jpg") => new File(["x"], name, { type: "image/jpeg" });

beforeEach(() => {
  push.mockReset();
  sessionStorage.clear();
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => `blob:test/${(n += 1)}`,
      revokeObjectURL: () => undefined,
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pending capture hand-over", () => {
  it("round-trips ids, and clear forgets them", () => {
    expect(stashPendingCapture([id(1), id(2)])).toBe(true);
    expect(peekPendingCapture()).toEqual([id(1), id(2)]);
    // Reading does not consume: a strict-mode double render sees the same ids.
    expect(peekPendingCapture()).toEqual([id(1), id(2)]);
    clearPendingCapture();
    expect(peekPendingCapture()).toEqual([]);
  });

  it("ignores stale, malformed and oversized hand-overs and refuses bad input", () => {
    const now = Date.now();
    stashPendingCapture([id(1)], now - 11 * 60 * 1000);
    expect(peekPendingCapture(now)).toEqual([]);

    sessionStorage.setItem("wasfa:capture:pending", "{not json");
    expect(peekPendingCapture()).toEqual([]);
    sessionStorage.setItem(
      "wasfa:capture:pending",
      JSON.stringify({ fileIds: ["not-a-uuid"], at: now }),
    );
    expect(peekPendingCapture(now)).toEqual([]);

    expect(stashPendingCapture([])).toBe(false);
    expect(stashPendingCapture(["x"])).toBe(false);
    expect(stashPendingCapture([1, 2, 3, 4, 5].map(id))).toBe(false);
  });
});

describe("QuickCapture", () => {
  function mount() {
    return render(
      <ToastProvider>
        <QuickCapture maxPages={4} />
      </ToastProvider>,
    );
  }

  it("is a compact capture surface in a named region", () => {
    fakeUploader();
    const { container } = mount();
    expect(screen.getByRole("region", { name: t("dashboard.capture.title") })).toBeTruthy();
    expect(container.querySelector('[data-variant="compact"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: t("capture.pick") })).toBeTruthy();
  });

  it("goes to /analyze with the uploaded file ids once a pasted picture is uploaded", async () => {
    const fake = fakeUploader();
    mount();
    paste(picture());
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/analyze");
    });
    expect(fake.upload).toHaveBeenCalledTimes(1);
    expect(peekPendingCapture()).toEqual([id(1)]);
    expect(push).toHaveBeenCalledTimes(1);
    await screen.findByText(t("dashboard.capture.going"));
  });

  it("stays when a page needs a quality decision, and goes after the person continues", async () => {
    fakeUploader(["blurry"]);
    mount();
    paste(picture("blurry.jpg"));
    await waitFor(() => {
      expect(document.querySelector('[data-status="warning"]')).toBeTruthy();
    });
    expect(push).not.toHaveBeenCalled();
    expect(peekPendingCapture()).toEqual([]);
  });

  it("stays without storage rather than losing the pages silently", async () => {
    fakeUploader();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount();
    paste(picture());
    await waitFor(() => {
      expect(document.querySelector('[data-status="uploaded"]')).toBeTruthy();
    });
    expect(push).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("AnalyzeCapture with pages from the dashboard", () => {
  it("shows them as uploaded pages, ready to analyze, and clears the hand-over", async () => {
    fakeUploader();
    stashPendingCapture([id(7), id(8)]);
    render(
      <ToastProvider>
        <AnalyzeCapture maxPages={4} creditsPerPage={3} balance={100} />
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(document.querySelectorAll('[data-status="uploaded"]')).toHaveLength(2);
    });
    expect(screen.getByText(t("capture.analyze.button", { price: 6 }))).toBeTruthy();
    expect(peekPendingCapture()).toEqual([]);
  });

  it("starts empty when nothing was handed over", () => {
    fakeUploader();
    render(
      <ToastProvider>
        <AnalyzeCapture maxPages={4} creditsPerPage={3} balance={100} />
      </ToastProvider>,
    );
    expect(document.querySelectorAll("[data-local-id]")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: t("capture.empty.title") })).toBeTruthy();
  });
});

describe("useChatAttachments", () => {
  const page = (status: CapturePage["status"], fileId: string | null): CapturePage => ({
    localId: `p-${String(fileId)}`,
    fileId,
    status,
    previewUrl: "",
    quality: { issues: [] },
  });

  it("offers only uploaded pages to the message, in order, and forgets them on clear", () => {
    fakeUploader();
    const { result } = renderHook(() => useChatAttachments());
    expect(result.current.fileIds).toEqual([]);
    act(() => {
      result.current.onPagesChange([
        page("uploaded", id(1)),
        page("uploading", null),
        page("uploaded", id(2)),
        page("error", null),
      ]);
    });
    expect(result.current.fileIds).toEqual([id(1), id(2)]);
    expect(result.current.count).toBe(4);
    const before = result.current.resetKey;
    act(() => {
      result.current.clear();
    });
    expect(result.current.count).toBe(0);
    expect(result.current.fileIds).toEqual([]);
    expect(result.current.resetKey).toBe(before + 1);
  });
});
