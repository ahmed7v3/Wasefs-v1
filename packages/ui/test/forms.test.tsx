import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Button, Checkbox, Field, Input, PasswordInput, Select } from "../src";

describe("Field", () => {
  it("links the label, hint and error to the control", () => {
    render(
      <Field label="البريد الإلكتروني" hint="نستخدمه لتسجيل الدخول" error="بريد غير صحيح" required>
        {(control) => <Input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText(/البريد الإلكتروني/);
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[0] ?? "")?.textContent).toBe(
      "نستخدمه لتسجيل الدخول",
    );
    expect(document.getElementById(describedBy[1] ?? "")?.textContent).toBe("بريد غير صحيح");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((input as HTMLInputElement).required).toBe(true);
  });

  it("shows the required marker as text, not only an asterisk", () => {
    render(
      <Field label="الاسم" required>
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(screen.getByText("(مطلوب)")).toBeTruthy();
  });

  it("adds no ARIA noise when there is no hint or error", () => {
    render(<Field label="الاسم">{(control) => <Input {...control} />}</Field>);
    const input = screen.getByLabelText("الاسم");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("announces the error with role=alert only when asked to", () => {
    const { rerender } = render(
      <Field label="الاسم" error="مطلوب">
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <Field label="الاسم" error="مطلوب" announceError>
        {(control) => <Input {...control} />}
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("مطلوب");
  });

  it("works with Select", () => {
    render(
      <Field label="المدينة" error="اختر مدينة">
        {(control) => (
          <Select {...control}>
            <option value="">اختر</option>
            <option value="cairo">القاهرة</option>
          </Select>
        )}
      </Field>,
    );
    const select = screen.getByLabelText("المدينة");
    expect(select.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("PasswordInput", () => {
  it("toggles between hidden and visible with an accessible button", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="كلمة المرور" />);
    const input = screen.getByLabelText("كلمة المرور");
    expect(input.getAttribute("type")).toBe("password");

    await user.click(screen.getByRole("button", { name: "إظهار كلمة المرور" }));
    expect(input.getAttribute("type")).toBe("text");

    await user.click(screen.getByRole("button", { name: "إخفاء كلمة المرور" }));
    expect(input.getAttribute("type")).toBe("password");
  });
});

describe("Input", () => {
  it("forces LTR for codes and marks invalid", () => {
    render(<Input aria-label="الكود" ltr invalid />);
    const input = screen.getByLabelText("الكود");
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("sets aria-disabled with disabled", () => {
    render(<Input aria-label="الاسم" disabled />);
    expect(screen.getByLabelText("الاسم").getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Checkbox", () => {
  it("is named by its label and toggles", async () => {
    const user = userEvent.setup();
    render(<Checkbox label="أوافق على الشروط" />);
    const box = screen.getByRole("checkbox", { name: "أوافق على الشروط" });
    expect((box as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByText("أوافق على الشروط"));
    expect((box as HTMLInputElement).checked).toBe(true);
  });
});

describe("Button loading", () => {
  it("disables, flags busy and does not click", async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <Button
        loading
        onClick={() => {
          clicks += 1;
        }}
      >
        حفظ
      </Button>,
    );
    const button = screen.getByRole("button", { name: "حفظ" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.click(button);
    expect(clicks).toBe(0);
  });

  it("is a normal button when not loading", () => {
    render(<Button>حفظ</Button>);
    const button = screen.getByRole("button", { name: "حفظ" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });
});
