import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CaptureSurface,
  ToastProvider,
  adjustInset,
  arrowToDelta,
  cropRect,
  fitLongEdge,
  keyToInsetDelta,
  moveItem,
  NO_CROP,
  PhoneHandoff,
  formatCountdown,
  type CapturePage,
  type CaptureUploader,
  type HandoffClient,
  type PreparedImage,
  type QualityIssue,
} from "../src";

const jpeg = (name = "a.jpg") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

function prepared(issues: QualityIssue[] = []): PreparedImage {
  return {
    blob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
    width: 1600,
    height: 1200,
    sha256: "0".repeat(64),
    issues,
  };
}

interface Fake {
  uploader: CaptureUploader;
  prepare: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
}

function fakeUploader(issues: QualityIssue[] = []): Fake {
  let next = 0;
  const prepare = vi.fn(async () => ({ pages: [prepared(issues)], trimmed: false }));
  const upload = vi.fn(async () => ({
    fileId: `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
  }));
  return { uploader: { prepare, upload }, prepare, upload };
}

function mount(
  overrides: Partial<React.ComponentProps<typeof CaptureSurface>> & { fake?: Fake } = {},
) {
  const fake = overrides.fake ?? fakeUploader();
  const onPagesChange = vi.fn<(pages: CapturePage[]) => void>();
  const view = render(
    <ToastProvider>
      <input aria-label="note" />
      <CaptureSurface
        maxPages={4}
        variant="full"
        uploader={fake.uploader}
        onPagesChange={onPagesChange}
        {...overrides}
      />
    </ToastProvider>,
  );
  return { fake, onPagesChange, ...view };
}

/** A DOM event carrying a `dataTransfer` / `clipboardData`, which jsdom does not construct itself. */
function transferEvent(
  type: string,
  key: "dataTransfer" | "clipboardData",
  data: { files?: File[]; types?: string[] },
  target: EventTarget = window,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const files = data.files ?? [];
  Object.defineProperty(event, key, {
    value: { files, items: [], types: data.types ?? (files.length > 0 ? ["Files"] : []) },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  document.documentElement.setAttribute("dir", "rtl");
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

async function addPages(count: number) {
  for (let i = 0; i < count; i += 1) {
    transferEvent("paste", "clipboardData", { files: [jpeg(`p${i}.jpg`)] });
  }
  await waitFor(() => {
    expect(screen.getAllByRole("listitem", { name: /^الصفحة/ })).toHaveLength(count);
  });
  await waitFor(() => {
    expect(document.querySelectorAll('[data-status="uploaded"]')).toHaveLength(count);
  });
}

describe("paste", () => {
  it("leaves text pasted into an input alone", () => {
    const { fake } = mount();
    const input = screen.getByLabelText("note");
    const event = transferEvent("paste", "clipboardData", { files: [] }, input);
    expect(event.defaultPrevented).toBe(false);
    expect(fake.prepare).not.toHaveBeenCalled();
  });

  it("adds an image pasted anywhere, even while an input has focus", async () => {
    const { fake } = mount();
    const input = screen.getByLabelText("note");
    input.focus();
    const event = transferEvent("paste", "clipboardData", { files: [jpeg()] }, input);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(fake.prepare).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(fake.upload).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores pasted files that are not images or PDFs", () => {
    const { fake } = mount();
    transferEvent("paste", "clipboardData", {
      files: [new File(["x"], "n.txt", { type: "text/plain" })],
    });
    expect(fake.prepare).not.toHaveBeenCalled();
  });
});

describe("drop", () => {
  it("shows the overlay while a file is dragged over the window and hides it on leave", () => {
    mount();
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    transferEvent("dragenter", "dataTransfer", { types: ["Files"] });
    expect(screen.getByTestId("drop-overlay")).toBeTruthy();
    expect(screen.getByText(t("capture.drop.title"))).toBeTruthy();
    transferEvent("dragenter", "dataTransfer", { types: ["Files"] });
    transferEvent("dragleave", "dataTransfer", { types: ["Files"] });
    // Moving between child elements fires enter and leave; the overlay stays until the depth is 0.
    expect(screen.getByTestId("drop-overlay")).toBeTruthy();
    transferEvent("dragleave", "dataTransfer", { types: ["Files"] });
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
  });

  it("does not react to dragged text", () => {
    mount();
    transferEvent("dragenter", "dataTransfer", { types: ["text/plain"] });
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
  });

  it("adds dropped images and hides the overlay", async () => {
    const { fake } = mount();
    transferEvent("dragenter", "dataTransfer", { types: ["Files"] });
    const event = transferEvent("drop", "dataTransfer", { files: [jpeg()] });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    await waitFor(() => {
      expect(fake.prepare).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses other files with a toast", () => {
    const { fake } = mount();
    transferEvent("drop", "dataTransfer", {
      files: [new File(["x"], "n.zip", { type: "application/zip" })],
    });
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(screen.getByText(t("capture.drop.refused"))).toBeTruthy();
  });
});

describe("the picker", () => {
  it("takes images and PDFs, several at once", async () => {
    const { fake } = mount();
    const input = screen.getByTestId("capture-picker") as HTMLInputElement;
    expect(input.accept).toBe("image/*,application/pdf");
    expect(input.multiple).toBe(true);
    fireEvent.change(input, { target: { files: [jpeg("a.jpg"), jpeg("b.jpg")] } });
    await waitFor(() => {
      expect(fake.prepare).toHaveBeenCalledTimes(2);
    });
  });

  it("stops at the plan's page limit and says so", async () => {
    const { fake } = mount({ maxPages: 2 });
    const input = screen.getByTestId("capture-picker");
    fireEvent.change(input, { target: { files: [jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")] } });
    await waitFor(() => {
      expect(fake.prepare).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText(t("capture.limit.full", { max: 2 }))).toBeTruthy();
  });
});

describe("reordering by keyboard", () => {
  it("moves a focused page with the arrow keys, following the screen direction, and announces it", async () => {
    const { onPagesChange } = mount();
    await addPages(3);
    const tiles = () => screen.getAllByRole("listitem", { name: /^الصفحة/ });
    const idsBefore = tiles().map((tile) => tile.getAttribute("data-local-id"));

    const first = tiles()[0];
    if (!first) throw new Error("no tile");
    first.focus();
    // RTL: the left arrow moves the page to the left on screen, which is later in the order.
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    const idsAfter = tiles().map((tile) => tile.getAttribute("data-local-id"));
    expect(idsAfter).toEqual([idsBefore[1], idsBefore[0], idsBefore[2]]);
    expect(document.activeElement?.getAttribute("data-local-id")).toBe(idsBefore[0]);
    expect(screen.getByTestId("capture-live").textContent).toContain(
      t("capture.live.moved", { position: 2, total: 3 }),
    );
    expect(onPagesChange.mock.lastCall?.[0].map((page) => page.localId)).toEqual(idsAfter);

    // The right arrow moves it back toward the start.
    const moved = document.activeElement;
    if (!moved) throw new Error("focus lost");
    fireEvent.keyDown(moved, { key: "ArrowRight" });
    expect(tiles().map((tile) => tile.getAttribute("data-local-id"))).toEqual(idsBefore);
  });

  it("does not move past the ends, and the move buttons do the same for the pointer", async () => {
    mount();
    await addPages(2);
    const tiles = () => screen.getAllByRole("listitem", { name: /^الصفحة/ });
    const ids = tiles().map((tile) => tile.getAttribute("data-local-id"));
    const first = tiles()[0];
    if (!first) throw new Error("no tile");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(tiles().map((tile) => tile.getAttribute("data-local-id"))).toEqual(ids);

    fireEvent.click(within(first).getByRole("button", { name: t("capture.page.later", { n: 1 }) }));
    expect(tiles().map((tile) => tile.getAttribute("data-local-id"))).toEqual([ids[1], ids[0]]);
  });

  it("removes a page and announces it", async () => {
    mount();
    await addPages(2);
    fireEvent.click(screen.getByRole("button", { name: t("capture.page.remove", { n: 1 }) }));
    expect(screen.getAllByRole("listitem", { name: /^الصفحة/ })).toHaveLength(1);
    expect(screen.getByTestId("capture-live").textContent).toContain(
      t("capture.live.removed", { n: 1, total: 1 }),
    );
  });
});

describe("quality hint", () => {
  it("holds a blurry photo back until the person decides", async () => {
    const fake = fakeUploader(["blurry"]);
    mount({ fake });
    transferEvent("paste", "clipboardData", { files: [jpeg()] });
    await screen.findByText(t("capture.quality.title.blurry"));
    expect(fake.upload).not.toHaveBeenCalled();
    expect(screen.getByText(t("capture.quality.free"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("capture.quality.continue") }));
    await waitFor(() => {
      expect(fake.upload).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("quality-hint")).toBeNull();
  });

  it("retake removes the page and opens the picker", async () => {
    const fake = fakeUploader(["dark"]);
    mount({ fake });
    const picker = screen.getByTestId("capture-picker") as HTMLInputElement;
    const click = vi.spyOn(picker, "click");
    transferEvent("paste", "clipboardData", { files: [jpeg()] });
    await screen.findByText(t("capture.quality.title.dark"));
    fireEvent.click(screen.getByRole("button", { name: t("capture.quality.retake") }));
    expect(click).toHaveBeenCalled();
    expect(screen.queryAllByRole("listitem", { name: /^الصفحة/ })).toHaveLength(0);
  });
});

describe("errors", () => {
  it("shows the support reference of a failed upload and retries it", async () => {
    const fake = fakeUploader();
    const { CaptureError } = await import("../src");
    fake.upload.mockRejectedValueOnce(new CaptureError("حدث خطأ", "WSF-ABCD-2345"));
    mount({ fake });
    transferEvent("paste", "clipboardData", { files: [jpeg()] });
    await screen.findByText(/WSF-ABCD-2345/);
    fireEvent.click(screen.getByRole("button", { name: t("capture.page.retryLabel", { n: 1 }) }));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-status="uploaded"]')).toHaveLength(1);
    });
    expect(fake.upload).toHaveBeenCalledTimes(2);
    expect(fake.prepare).toHaveBeenCalledTimes(1);
  });
});

describe("the Analyze bar", () => {
  it("shows the price and balance, and sends the file ids in order once everything is uploaded", async () => {
    const onAnalyze = vi.fn<(ids: string[]) => Promise<void>>(async () => undefined);
    mount({ price: { perPage: 2, balance: 10 }, onAnalyze });
    await addPages(2);
    expect(screen.getByText(t("capture.analyze.balance", { balance: 10 }))).toBeTruthy();
    const button = screen.getByRole("button", { name: t("capture.analyze.button", { price: 4 }) });
    fireEvent.click(button);
    await waitFor(() => {
      expect(onAnalyze).toHaveBeenCalledTimes(1);
    });
    const ids = onAnalyze.mock.calls[0]?.[0];
    expect(ids).toHaveLength(2);
  });

  it("is disabled with a reason while a page is still uploading", async () => {
    const fake = fakeUploader();
    fake.upload.mockImplementation(() => new Promise(() => undefined));
    mount({ fake, price: { perPage: 1, balance: 5 }, onAnalyze: vi.fn() });
    transferEvent("paste", "clipboardData", { files: [jpeg()] });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-status="uploading"]')).toHaveLength(1);
    });
    expect((screen.getByRole("button", { name: /تحليل/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(t("capture.analyze.waitUploads"))).toBeTruthy();
  });

  it("turns into 'not enough credits' with a support link", async () => {
    const onAnalyze = vi.fn();
    mount({ price: { perPage: 3, balance: 2 }, onAnalyze, supportHref: "/contact" });
    await addPages(1);
    expect(screen.getByText(t("capture.analyze.insufficient"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /تحليل —/ })).toBeNull();
    const link = screen.getByRole("link", { name: t("capture.analyze.support") });
    expect(link.getAttribute("href")).toBe("/contact");
  });
});

describe("phone handoff", () => {
  function fakeHandoff() {
    let emit: (fileId: string) => void = () => undefined;
    const client: HandoffClient = {
      start: vi.fn(async () => ({
        url: "https://wasfa.online/capture/abc",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      })),
      subscribe: vi.fn((_id: string, onFile: (fileId: string) => void) => {
        emit = onFile;
        return () => undefined;
      }),
      qr: vi.fn(async () => "data:image/svg+xml;charset=utf-8,x"),
      adopt: vi.fn(async () => ({ previewUrl: "https://img.example/p.jpg" })),
    };
    return { client, emit: (id: string) => emit(id) };
  }

  it("shows the code, then adds a phone page live without analysing", async () => {
    const { client, emit } = fakeHandoff();
    const onAnalyze = vi.fn();
    const { onPagesChange } = mount({ handoff: client, onAnalyze });
    fireEvent.click(screen.getByRole("button", { name: t("capture.phone") }));
    await screen.findByAltText(t("capture.handoff.qrAlt"));
    expect(screen.getByText(t("capture.handoff.waiting"))).toBeTruthy();
    expect(screen.getByText(t("capture.handoff.note"))).toBeTruthy();

    act(() => {
      emit("00000000-0000-4000-8000-0000000000aa");
      // The same event twice (a reconnect) adds one page.
      emit("00000000-0000-4000-8000-0000000000aa");
    });
    await waitFor(() => {
      expect(onPagesChange.mock.lastCall?.[0]).toMatchObject([
        { status: "uploaded", fileId: "00000000-0000-4000-8000-0000000000aa" },
      ]);
    });
    expect(screen.getByText(t("capture.handoff.connected", { count: 1, max: 4 }))).toBeTruthy();
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("offers a new code when the first one expired", () => {
    const onRenew = vi.fn();
    render(
      <PhoneHandoff
        open
        view={{ kind: "expired" }}
        max={4}
        onRenew={onRenew}
        onClose={() => undefined}
        onExpire={() => undefined}
      />,
    );
    expect(screen.getByText(t("capture.handoff.expired.title"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("capture.handoff.renew") }));
    expect(onRenew).toHaveBeenCalled();
  });

  it("formats the countdown with Western digits", () => {
    expect(formatCountdown(272)).toBe("4:32");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("pure helpers", () => {
  it("moveItem clamps and keeps identity of the rest", () => {
    const items = [{ localId: "a" }, { localId: "b" }, { localId: "c" }];
    expect(moveItem(items, "a", 1).map((i) => i.localId)).toEqual(["b", "a", "c"]);
    expect(moveItem(items, "c", 5).map((i) => i.localId)).toEqual(["a", "b", "c"]);
    expect(moveItem(items, "x", 1).map((i) => i.localId)).toEqual(["a", "b", "c"]);
  });

  it("arrowToDelta follows the screen direction", () => {
    expect(arrowToDelta("ArrowRight", true)).toBe(-1);
    expect(arrowToDelta("ArrowRight", false)).toBe(1);
    expect(arrowToDelta("ArrowLeft", true)).toBe(1);
    expect(arrowToDelta("a", true)).toBeNull();
  });

  it("crop edges stay inside the image and leave at least 10%", () => {
    expect(adjustInset(NO_CROP, "left", 0.3).left).toBe(0.3);
    expect(adjustInset({ ...NO_CROP, right: 0.5 }, "left", 0.9).left).toBe(0.4);
    expect(adjustInset(NO_CROP, "top", -0.2).top).toBe(0);
    expect(keyToInsetDelta("left", "ArrowRight", 0.01)).toBe(0.01);
    expect(keyToInsetDelta("right", "ArrowRight", 0.01)).toBe(-0.01);
    expect(keyToInsetDelta("bottom", "ArrowUp", 0.05)).toBe(0.05);
    expect(keyToInsetDelta("top", "Enter", 0.05)).toBeNull();
    expect(cropRect({ top: 0.1, right: 0.2, bottom: 0.1, left: 0.1 }, 1000, 500)).toEqual({
      x: 100,
      y: 50,
      width: 700,
      height: 400,
    });
  });

  it("fitLongEdge never upscales", () => {
    expect(fitLongEdge(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitLongEdge(1000, 800, 2048)).toEqual({ width: 1000, height: 800 });
  });
});

describe("pages that are already uploaded (dashboard quick capture)", () => {
  const ids = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];
  const adoptingClient = (): HandoffClient => ({
    start: vi.fn(async () => ({ url: "https://wasfa.online/capture/x", expiresAt: "" })),
    subscribe: vi.fn(() => () => undefined),
    qr: vi.fn(async () => undefined),
    adopt: vi.fn(async () => ({ previewUrl: "https://img.example/p.jpg" })),
  });

  it("shows them as uploaded pages in order, ready for Analyze", async () => {
    const handoff = adoptingClient();
    const onAnalyze = vi.fn(async () => undefined);
    const { onPagesChange } = mount({ handoff, initialFileIds: ids, onAnalyze });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-status="uploaded"]')).toHaveLength(2);
    });
    expect(onPagesChange.mock.lastCall?.[0]?.map((page) => page.fileId)).toEqual(ids);
    fireEvent.click(screen.getByRole("button", { name: /تحليل|ابدأ/ }));
    await waitFor(() => {
      expect(onAnalyze).toHaveBeenCalledWith(ids);
    });
  });
});

describe("pages that are already uploaded under React strict mode", () => {
  it("adds each once even though the effects run, clean up and run again", async () => {
    const ids = ["00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000b2"];
    const handoff: HandoffClient = {
      start: vi.fn(async () => ({ url: "https://wasfa.online/capture/x", expiresAt: "" })),
      subscribe: vi.fn(() => () => undefined),
      qr: vi.fn(async () => undefined),
      adopt: vi.fn(async () => ({ previewUrl: "https://img.example/p.jpg" })),
    };
    render(
      <StrictMode>
        <ToastProvider>
          <CaptureSurface
            variant="full"
            maxPages={4}
            uploader={fakeUploader().uploader}
            handoff={handoff}
            initialFileIds={ids}
            onPagesChange={() => undefined}
          />
        </ToastProvider>
      </StrictMode>,
    );
    await waitFor(() => {
      expect(document.querySelectorAll('[data-status="uploaded"]')).toHaveLength(2);
    });
    expect(screen.getAllByRole("listitem", { name: /^الصفحة/ })).toHaveLength(2);
  });
});

describe("collapsed", () => {
  it("draws nothing while empty, yet still takes a pasted picture and then shows it", async () => {
    const { fake } = mount({ variant: "composer", collapsed: true });
    expect(screen.queryByRole("button", { name: "اختر صورة" })).toBeNull();
    transferEvent("paste", "clipboardData", { files: [jpeg("c.jpg")] });
    await waitFor(() => {
      expect(fake.upload).toHaveBeenCalledTimes(1);
    });
    expect(screen.getAllByRole("listitem", { name: /^الصفحة/ })).toHaveLength(1);
  });
});

describe("touch devices and the close button", () => {
  /** Makes `matchMedia` answer true only for the listed queries. */
  function media(matching: string[]) {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: matching.includes(query),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  }

  const handoff = {
    start: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    adopt: vi.fn(),
  } as unknown as HandoffClient;

  it("shows the camera button, and not 'use your phone', on a coarse pointer", async () => {
    media(["(pointer: coarse)"]);
    mount({ handoff });
    expect(await screen.findByRole("button", { name: t("capture.camera") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("capture.phone") })).toBeNull();
  });

  it("still finds a touch device whose main pointer reports fine", async () => {
    media(["(any-pointer: coarse)"]);
    mount({ handoff });
    expect(await screen.findByRole("button", { name: t("capture.camera") })).toBeTruthy();
  });

  it("offers 'use your phone' and no camera button on a desktop", async () => {
    media(["(hover: hover) and (pointer: fine)"]);
    mount({ handoff });
    expect(await screen.findByRole("button", { name: t("capture.phone") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("capture.camera") })).toBeNull();
  });

  it("closes the open panel from the X button", () => {
    media([]);
    const onClose = vi.fn();
    mount({ variant: "composer", onClose });
    fireEvent.click(screen.getByRole("button", { name: t("capture.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
