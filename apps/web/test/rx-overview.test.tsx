// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it } from "vitest";

import { RxOverview } from "../src/components/rx/rx-overview";

describe("RxOverview", () => {
  it("shows the summary, the possible conditions and always the not-a-diagnosis note", () => {
    render(
      <RxOverview
        result={{
          detailsStatus: "ready",
          overview: {
            summary: "أدوية تُستخدم عادةً لاضطرابات هرمونية.",
            likelyConditions: ["قد يُستخدم في ارتفاع البرولاكتين"],
          },
        }}
      />,
    );
    expect(screen.getByTestId("rx-overview")).toBeTruthy();
    expect(screen.getByText("أدوية تُستخدم عادةً لاضطرابات هرمونية.")).toBeTruthy();
    expect(screen.getByText("قد يُستخدم في ارتفاع البرولاكتين")).toBeTruthy();
    expect(screen.getByText(t("rx.overview.note"))).toBeTruthy();
  });

  it("says the reading is complete when the details step could not run", () => {
    render(<RxOverview result={{ detailsStatus: "unavailable", overview: null }} />);
    expect(screen.getByTestId("rx-overview-unavailable").textContent).toContain(
      t("rx.overview.unavailable"),
    );
  });

  it("renders nothing for results from before details existed", () => {
    const { container } = render(<RxOverview result={{ overview: undefined }} />);
    expect(container.firstChild).toBeNull();
  });
});
