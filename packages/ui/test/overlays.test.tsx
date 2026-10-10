import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog, ToastProvider, useToast } from "../src";

function DialogExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        افتح
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="حذف الحساب"
        description="لا يمكن التراجع عن هذا الإجراء."
        actions={<button type="button">حذف الحساب نهائيًا</button>}
      >
        <p>محتوى</p>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("is closed by default and named by its title and description", async () => {
    const user = userEvent.setup();
    render(<DialogExample />);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "افتح" }));
    const dialog = screen.getByRole("dialog", { name: "حذف الحساب" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("لا يمكن التراجع عن هذا الإجراء.");
  });

  it("closes with the close button and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<DialogExample />);
    const opener = screen.getByRole("button", { name: "افتح" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Esc and returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<DialogExample />);
    const opener = screen.getByRole("button", { name: "افتح" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("can be reopened after closing", async () => {
    const user = userEvent.setup();
    render(<DialogExample />);
    await user.click(screen.getByRole("button", { name: "افتح" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "افتح" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

function ToastExample() {
  const { toast } = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast({ title: "تم الحفظ", tone: "success" });
        }}
      >
        نجاح
      </button>
      <button
        type="button"
        onClick={() => {
          toast({ title: "فشل الحفظ", description: "حاول مرة أخرى", tone: "error" });
        }}
      >
        خطأ
      </button>
      <button
        type="button"
        onClick={() => {
          toast({ title: "معلومة", tone: "info" });
        }}
      >
        معلومة
      </button>
    </>
  );
}

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses role=status for success/info and role=alert for errors", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastExample />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "نجاح" }));
    await user.click(screen.getByRole("button", { name: "خطأ" }));
    expect(screen.getByRole("status").textContent).toContain("تم الحفظ");
    expect(screen.getByRole("alert").textContent).toContain("فشل الحفظ");
  });

  it("shows at most 3 toasts, dropping the oldest", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastExample />
      </ToastProvider>,
    );
    const success = screen.getByRole("button", { name: "نجاح" });
    await user.click(success);
    await user.click(success);
    await user.click(success);
    await user.click(screen.getByRole("button", { name: "خطأ" }));
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("dismisses non-errors after 5 s but keeps errors until dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <ToastProvider>
        <ToastExample />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "نجاح" }));
    await user.click(screen.getByRole("button", { name: "خطأ" }));

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "إخفاء التنبيه" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
