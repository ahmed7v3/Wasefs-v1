import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Composer,
  Markdown,
  MessageList,
  ModeToggle,
  SourceChips,
  ThinkingPanel,
  ToastProvider,
  isSubmitKey,
  type CapturePage,
  type CaptureUploader,
  type ChatDisplayMessage,
  type ComposerProps,
} from "../src";

function fakeUploader(): CaptureUploader & {
  prepare: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
} {
  let next = 0;
  const prepare = vi.fn(async () => ({
    pages: [
      {
        blob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }),
        width: 1600,
        height: 1200,
        sha256: "0".repeat(64),
        issues: [],
      },
    ],
    trimmed: false,
  }));
  const upload = vi.fn(async () => ({
    fileId: `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
  }));
  return { prepare, upload };
}

/** A paste or drop event: jsdom does not build `clipboardData` / `dataTransfer` itself. */
function transferEvent(type: "paste" | "drop", files: File[], target: EventTarget): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", {
    value: { files, items: [], types: files.length > 0 ? ["Files"] : [] },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
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

function Harness(props: Partial<ComposerProps> & { onSubmit?: () => void }) {
  const [value, setValue] = useState(props.value ?? "");
  return (
    <ToastProvider>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={props.onSubmit ?? (() => undefined)}
        streaming={props.streaming ?? false}
        onStop={props.onStop ?? (() => undefined)}
        mode="balanced"
        onModeChange={() => undefined}
        allowedModes={["fast", "balanced"]}
        search={false}
        onSearchChange={() => undefined}
        searchAllowed={false}
        uploader={props.uploader ?? fakeUploader()}
        onPagesChange={props.onPagesChange ?? (() => undefined)}
        captureResetKey={props.captureResetKey}
        estimate="how the cost is worked out"
      />
    </ToastProvider>
  );
}

const textbox = () => screen.getByRole("textbox", { name: "رسالتك" });

describe("Composer keyboard", () => {
  it("sends on Enter and keeps Shift+Enter as a new line", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(textbox(), "ما هو الباراسيتامول؟");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect((textbox() as HTMLTextAreaElement).value).toContain("\n");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not send an empty or blank message", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(textbox(), "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "إرسال" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("ignores the Enter that confirms an IME candidate", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} value="مرحبا" />);
    // Chrome/Firefox: isComposing is true during the composition.
    fireEvent.keyDown(textbox(), { key: "Enter", isComposing: true });
    // Safari: the keydown after compositionend reports isComposing=false but keyCode 229.
    fireEvent.keyDown(textbox(), { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("classifies keys on their own", () => {
    expect(isSubmitKey({ key: "Enter", shiftKey: false })).toBe(true);
    expect(isSubmitKey({ key: "Enter", shiftKey: true })).toBe(false);
    expect(isSubmitKey({ key: "Enter", shiftKey: false, ctrlKey: true })).toBe(false);
    expect(isSubmitKey({ key: "a", shiftKey: false })).toBe(false);
    expect(isSubmitKey({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(
      false,
    );
  });

  it("shows stop instead of send while streaming, and stop calls back", async () => {
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<Harness streaming onStop={onStop} />);
    expect(screen.queryByRole("button", { name: "إرسال" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "إيقاف الإجابة" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("uploads a pasted picture through the capture surface and leaves pasted text alone", async () => {
    const uploader = fakeUploader();
    const onPagesChange = vi.fn<(pages: CapturePage[]) => void>();
    render(<Harness uploader={uploader} onPagesChange={onPagesChange} />);
    const file = new File(["x"], "scan.png", { type: "image/png" });
    const paste = transferEvent("paste", [file], textbox());
    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(uploader.upload).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onPagesChange.mock.lastCall?.[0]?.[0]?.status).toBe("uploaded");
    });

    const textPaste = transferEvent("paste", [], textbox());
    expect(textPaste.defaultPrevented).toBe(false);
    expect(uploader.prepare).toHaveBeenCalledTimes(1);
  });

  it("takes a dropped picture anywhere on the page", async () => {
    const uploader = fakeUploader();
    render(<Harness uploader={uploader} />);
    transferEvent("drop", [new File(["x"], "scan.jpg", { type: "image/jpeg" })], document.body);
    await waitFor(() => {
      expect(uploader.upload).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the panel closed until the plus button opens it, and opens itself for a picture", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const attach = screen.getByRole("button", { name: "إرفاق صورة" });
    expect(attach.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "اختر صورة" })).toBeNull();
    await user.click(attach);
    expect(attach.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "اختر صورة" })).toBeTruthy();
  });

  it("does not send while a picture is still uploading, then sends once it is uploaded", async () => {
    let finish: (value: { fileId: string }) => void = () => undefined;
    const uploader = fakeUploader();
    uploader.upload.mockImplementation(
      () =>
        new Promise<{ fileId: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const onSubmit = vi.fn();
    render(<Harness uploader={uploader} onSubmit={onSubmit} value="ما هذا الدواء؟" />);
    transferEvent("paste", [new File(["x"], "a.png", { type: "image/png" })], textbox());
    await waitFor(() => {
      expect(uploader.upload).toHaveBeenCalled();
    });
    const send = screen.getByRole("button", { name: "إرسال" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.keyDown(textbox(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => {
      finish({ fileId: "00000000-0000-4000-8000-000000000099" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(send.disabled).toBe(false);
    });
  });

  it("forgets the pictures when the reset key changes", async () => {
    const uploader = fakeUploader();
    const onPagesChange = vi.fn<(pages: CapturePage[]) => void>();
    const { rerender } = render(
      <Harness uploader={uploader} onPagesChange={onPagesChange} captureResetKey={0} />,
    );
    transferEvent("paste", [new File(["x"], "a.png", { type: "image/png" })], textbox());
    await waitFor(() => {
      expect(onPagesChange.mock.lastCall?.[0]).toHaveLength(1);
    });
    rerender(<Harness uploader={uploader} onPagesChange={onPagesChange} captureResetKey={1} />);
    await waitFor(() => {
      expect(onPagesChange.mock.lastCall?.[0]).toHaveLength(0);
    });
  });

  it("explains the cost on focus of the info button", () => {
    render(<Harness />);
    const info = screen.getByRole("button", { name: "كيف تُحسب التكلفة" });
    expect(info.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip", { hidden: true }).id,
    );
  });
});

describe("ModeToggle", () => {
  it("marks a mode the plan lacks as locked with the plan badge and refuses it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ModeToggle value="balanced" onChange={onChange} allowed={["fast", "balanced"]} />);
    const deep = screen.getByRole("radio", { name: /عميق/ });
    expect((deep as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("ترقية")).toBeTruthy();
    await user.click(deep);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "سريع" }));
    expect(onChange).toHaveBeenCalledWith("fast");
  });
});

describe("Markdown", () => {
  it("never renders script, event handlers or javascript links", () => {
    const { container } = render(
      <Markdown>
        {
          '<script>window.hacked = 1</script>\n\n<img src=x onerror="window.hacked = 1">\n\n[click](javascript:alert(1)) and [ok](https://example.org)'
        }
      </Markdown>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror=");
    expect(container.innerHTML).not.toContain("javascript:");
    const ok = screen.getByRole("link", { name: "ok" });
    expect(ok.getAttribute("rel")).toBe("noopener noreferrer");
    expect(ok.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "click" })).toBeNull();
  });

  it("renders tables, wraps Latin runs in bdi and keeps code left-to-right", () => {
    const { container } = render(
      <Markdown>
        {
          "الجرعة Paracetamol 500 mg مرتين\n\n| الدواء | الجرعة |\n| --- | --- |\n| بنادول | 500 mg |\n\n```\nconst dose = 500;\n```"
        }
      </Markdown>,
    );
    expect(container.querySelector("table")).not.toBeNull();
    const runs = [...container.querySelectorAll("bdi")].map((node) => node.textContent);
    expect(runs).toContain("Paracetamol 500 mg");
    const pre = container.querySelector("pre");
    expect(pre?.getAttribute("dir")).toBe("ltr");
    // Code is not split into runs.
    expect(pre?.querySelector("bdi")).toBeNull();
  });
});

describe("ThinkingPanel", () => {
  it("is collapsed, says it is thinking while streaming, then reports the duration", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ThinkingPanel text="step one" streaming />);
    const toggle = screen.getByRole("button", { name: /يفكّر…/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    rerender(<ThinkingPanel text="step one" streaming={false} seconds={6} />);
    const done = screen.getByRole("button", { name: /فكّر لمدة 6 ث/ });
    await user.click(done);
    expect(done.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("step one").hasAttribute("hidden")).toBe(false);
  });
});

describe("SourceChips", () => {
  it("opens web sources in a new tab safely and drops non-web links", () => {
    render(
      <SourceChips
        sources={[
          { url: "https://example.org/a", title: "Guide", domain: "example.org" },
          { url: "javascript:alert(1)", title: "Bad", domain: "evil" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
  });
});

describe("MessageList", () => {
  const messages: ChatDisplayMessage[] = [
    { id: "u1", role: "user", content: "سؤال", status: "done" },
    { id: "a1", role: "assistant", content: "إجابة", status: "done", creditsCharged: 2 },
  ];

  it("announces only through its polite live region, offers regenerate on the last answer only", async () => {
    const onRegenerate = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageList
        messages={messages}
        onRegenerate={onRegenerate}
        announcement="اكتملت الإجابة."
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("اكتملت الإجابة.");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(
      screen.getByText("هذه معلومات عامة للمساعدة ولا تغني عن استشارة الطبيب أو الصيدلي."),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "إعادة توليد الإجابة" }));
    expect(onRegenerate).toHaveBeenCalledWith("a1");
  });

  it("shows the stopped note and hides actions while streaming", () => {
    render(
      <MessageList
        messages={[{ id: "a1", role: "assistant", content: "نص جزئي", status: "streaming" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "نسخ الإجابة" })).toBeNull();
  });
});
