// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PhoneInput } from "../src/components/forms/phone-input";
import { nationalDigits, splitInternational, toE164 } from "../src/lib/phone";

function Harness({ onValue }: { onValue: (value: string) => void }) {
  const [, setValue] = useState("");
  return (
    <PhoneInput
      name="phoneNumber"
      onChange={(value) => {
        setValue(value);
        onValue(value);
      }}
    />
  );
}

function lastValue(spy: ReturnType<typeof vi.fn>): string {
  return String(spy.mock.calls.at(-1)?.[0]);
}

describe("PhoneInput", () => {
  it("defaults to Egypt and emits E.164 with the leading zero stripped", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "01012345678");
    expect(lastValue(onValue)).toBe("+201012345678");
  });

  it("follows the chosen country", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "SA");
    await userEvent.type(screen.getByRole("textbox"), "0512345678");
    expect(lastValue(onValue)).toBe("+966512345678");
  });

  it("re-emits when the country changes after the number was typed", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.type(screen.getByRole("textbox"), "512345678");
    expect(lastValue(onValue)).toBe("+20512345678");
    await userEvent.selectOptions(screen.getByRole("combobox"), "AE");
    expect(lastValue(onValue)).toBe("+971512345678");
  });

  it("accepts Arabic-Indic digits and ignores separators", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.type(screen.getByRole("textbox"), "٠١٠ ١٢٣٤-٥٦٧٨");
    expect(lastValue(onValue)).toBe("+201012345678");
  });

  it("emits an empty string while nothing is typed", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "0");
    expect(lastValue(onValue)).toBe("");
    await userEvent.type(input, "{Backspace}");
    expect(lastValue(onValue)).toBe("");
  });

  it("picks the country from a pasted international number", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.paste("+966 51 234 5678");
    expect(lastValue(onValue)).toBe("+966512345678");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("SA");
  });

  it("is an LTR telephone field with the right autocomplete", () => {
    render(<Harness onValue={() => undefined} />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.getAttribute("inputmode")).toBe("tel");
    expect(input.getAttribute("autocomplete")).toBe("tel-national");
    expect(input.getAttribute("name")).toBe("phoneNumber");
    expect(screen.getByRole("combobox").getAttribute("aria-label")).toBeTruthy();
  });
});

describe("phone helpers", () => {
  it("normalises national numbers", () => {
    expect(nationalDigits("0101 234-5678")).toBe("1012345678");
    expect(nationalDigits("٠١٠١٢٣٤٥٦٧٨")).toBe("1012345678");
    expect(nationalDigits("000123")).toBe("123");
    expect(toE164("20", "")).toBe("");
    expect(toE164("1", "(415) 555-0100")).toBe("+14155550100");
  });

  it("splits an international number by the longest dial code", () => {
    expect(splitInternational("+971501234567")?.country.iso).toBe("AE");
    expect(splitInternational("00201012345678")).toMatchObject({
      country: { iso: "EG" },
      national: "1012345678",
    });
    expect(splitInternational("+999123")).toBeNull();
    expect(splitInternational("01012345678")).toBeNull();
  });
});
