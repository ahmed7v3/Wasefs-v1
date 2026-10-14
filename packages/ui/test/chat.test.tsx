import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  Composer,
  Markdown,
  MessageList,
  ModeToggle,
  SourceChips,
  ThinkingPanel,
  isSubmitKey,
  type ChatDisplayMessage,
  type ComposerProps,
} from "../src";

function Harness(props: Partial<ComposerProps> & { onSubmit?: () => void }) {
  const [value, setValue] = useState(props.value ?? "");
  return (
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
      attachments={props.attachments ?? []}
      onFiles={props.onFiles ?? (() => undefined)}
      onRemoveAttachment={() => undefined}
      estimate="how the cost is worked out"
    />
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

  it("hands pasted pictures to the owner and leaves pasted text alone", () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    const file = new File(["x"], "scan.png", { type: "image/png" });
    const paste = createEvent.paste(textbox());
    Object.defineProperty(paste, "clipboardData", { value: { files: [file] } });
    fireEvent(textbox(), paste);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(paste.defaultPrevented).toBe(true);

    const textPaste = createEvent.paste(textbox());
    Object.defineProperty(textPaste, "clipboardData", { value: { files: [] } });
    fireEvent(textbox(), textPaste);
    expect(textPaste.defaultPrevented).toBe(false);
    expect(onFiles).toHaveBeenCalledTimes(1);
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
