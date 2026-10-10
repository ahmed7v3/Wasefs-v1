import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar, Badge, ComingSoonBadge, EmptyState, Skeleton, Spinner, getInitials } from "../src";

describe("Avatar", () => {
  it("falls back to initials without an image", () => {
    render(<Avatar name="أحمد محمد" />);
    expect(screen.getByRole("img", { name: "أحمد محمد" })).toBeTruthy();
    expect(screen.getByText("أم")).toBeTruthy();
  });

  it("renders the image when a src is given, and falls back when it fails", () => {
    render(<Avatar name="Sara Ali" src="https://example.test/a.png" />);
    const image = screen.getByRole("img", { name: "Sara Ali" });
    expect(image.tagName).toBe("IMG");
    fireEvent.error(image);
    expect(screen.getByRole("img", { name: "Sara Ali" }).tagName).toBe("SPAN");
    expect(screen.getByText("SA")).toBeTruthy();
  });

  it("builds initials safely", () => {
    expect(getInitials("  sara  ")).toBe("S");
    expect(getInitials("Sara Ali Khan")).toBe("SA");
    expect(getInitials("")).toBe("?");
  });
});

describe("Badge", () => {
  it("always carries text for every tone", () => {
    for (const tone of ["success", "warning", "danger", "info", "neutral"] as const) {
      const { unmount } = render(<Badge tone={tone}>حالة {tone}</Badge>);
      expect(screen.getByText(`حالة ${tone}`)).toBeTruthy();
      unmount();
    }
  });

  it("has a coming-soon badge from i18n", () => {
    render(<ComingSoonBadge />);
    expect(screen.getByText("قريباً")).toBeTruthy();
  });
});

describe("Skeleton, Spinner, EmptyState", () => {
  it("hides the skeleton from assistive tech", () => {
    const { container } = render(<Skeleton className="h-6 w-40" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("announces the spinner with sr-only text", () => {
    render(<Spinner />);
    expect(screen.getByRole("status").textContent).toBe("جارٍ التحميل…");
  });

  it("renders title, description and one action", () => {
    render(
      <EmptyState
        title="لا توجد جلسات"
        description="ستظهر جلساتك هنا."
        action={<button type="button">تحديث</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "لا توجد جلسات" })).toBeTruthy();
    expect(screen.getByText("ستظهر جلساتك هنا.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "تحديث" })).toBeTruthy();
  });
});
