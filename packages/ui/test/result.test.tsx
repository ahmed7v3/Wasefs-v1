/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures indexed after length assertions */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it, vi } from "vitest";

import {
  CandidatePicker,
  ConfidenceBadge,
  ImageViewer,
  RxTable,
  StepProgress,
  anchorTransform,
  boxToStyle,
  clampTransform,
  fitSize,
  formatElapsed,
  regionAt,
  revealBox,
  shownConfidence,
  stageToBox,
  type RxTableItem,
} from "../src";

const item = (over: Partial<RxTableItem> = {}): RxTableItem => ({
  rawText: "Augmntin 1g",
  name: "Augmentin",
  matchedDrugId: "00000000-0000-4000-8000-000000000001",
  activeIngredients: ["Amoxicillin"],
  strength: "1 g",
  form: "tablet",
  dose: null,
  frequency: "3 مرات يوميًا",
  duration: null,
  route: null,
  badge: "high",
  verified: "not_needed",
  details: undefined,
  ...over,
});

function table(items: RxTableItem[], props: Partial<React.ComponentProps<typeof RxTable>> = {}) {
  return render(
    <RxTable
      items={items}
      activeIndex={null}
      selectedIndex={null}
      onActivate={vi.fn()}
      onSelect={vi.fn()}
      onReview={vi.fn()}
      {...props}
    />,
  );
}

describe("RxTable", () => {
  it("is a table with column headers, row headers and scope", () => {
    table([item(), item({ name: "Panadol" })]);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(3);
    for (const header of headers) expect(header.getAttribute("scope")).toBe("col");
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(2);
    expect(rowHeaders[0]?.getAttribute("scope")).toBe("row");
    expect(screen.getByRole("table").className).toContain("tabular-nums");
    expect(within(rowHeaders[0]!).getByText("Amoxicillin")).toBeTruthy();
  });

  it("flags medium and low rows with an edge, a badge and a review button; high rows have none", () => {
    const onReview = vi.fn();
    table([item(), item({ badge: "medium" }), item({ badge: "low" })], { onReview });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.getAttribute("data-flagged")).toBeNull();
    expect(rows[1]?.getAttribute("data-flagged")).toBe("true");
    expect(rows[1]!.className).toContain("max-xl:border-s-warning");
    expect(within(rows[0]!).queryByRole("button", { name: /راجع/ })).toBeNull();
    fireEvent.click(within(rows[2]!).getByRole("button", { name: /راجع/ }));
    expect(onReview).toHaveBeenCalledWith(2);
    expect(within(rows[2]!).getByText(t("rx.badge.low"))).toBeTruthy();
  });

  it("shows an unmatched line as raw text with the unconfirmed badge, never high", () => {
    table([item({ matchedDrugId: null, badge: "high", name: "Guessed" })]);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("Augmntin 1g")).toBeTruthy();
    expect(within(row).queryByText("Guessed")).toBeNull();
    expect(within(row).getByText(t("rx.unmatched"))).toBeTruthy();
    expect(row.getAttribute("data-confidence")).toBe("medium");
    expect(within(row).getByRole("button", { name: /راجع/ })).toBeTruthy();
    expect(within(row).queryByText(t("rx.badge.high"))).toBeNull();
  });

  it("reports hover, focus and selection of a row", () => {
    const onActivate = vi.fn();
    const onSelect = vi.fn();
    table([item()], { onActivate, onSelect });
    const row = screen.getAllByRole("row")[1]!;
    fireEvent.mouseEnter(row);
    expect(onActivate).toHaveBeenLastCalledWith(0);
    fireEvent.mouseLeave(row);
    expect(onActivate).toHaveBeenLastCalledWith(null);
    const button = within(row).getAllByRole("button")[0]!;
    fireEvent.focus(button);
    expect(onActivate).toHaveBeenLastCalledWith(0);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

describe("ConfidenceBadge", () => {
  it("has an icon and text for every level, and clamps unmatched high", () => {
    expect(shownConfidence("high", true)).toBe("medium");
    expect(shownConfidence("high", false)).toBe("high");
    const { container } = render(<ConfidenceBadge level="low" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(t("rx.badge.low"))).toBeTruthy();
  });
});

describe("StepProgress", () => {
  it("marks done, current and pending steps and formats the clock", () => {
    render(
      <StepProgress
        steps={[
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ]}
        current={1}
        elapsedSeconds={75}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "current", "pending"]);
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(formatElapsed(75)).toBe("1:15");
    expect(screen.getByText(t("rx.progress.elapsed", { time: "1:15" }))).toBeTruthy();
  });
});

describe("viewer math", () => {
  const content = { width: 400, height: 300 };
  const stage = { width: 400, height: 300 };

  it("maps a 0-1000 box to logical percentages", () => {
    expect(boxToStyle([100, 200, 300, 600])).toEqual({
      insetInlineStart: "20%",
      insetBlockStart: "10%",
      inlineSize: "40%",
      blockSize: "20%",
    });
  });

  it("fits the image into the stage and keeps it centred at scale 1", () => {
    expect(fitSize({ width: 2000, height: 1000 }, { width: 400, height: 400 })).toEqual({
      width: 400,
      height: 200,
    });
    expect(clampTransform({ scale: 1, x: 50, y: 50 }, { width: 400, height: 200 }, stage)).toEqual({
      scale: 1,
      x: 0,
      y: 50,
    });
  });

  it("zooms around a point and never leaves the image", () => {
    const origin = { scale: 1, x: 0, y: 0 };
    const middle = { x: 200, y: 150 };
    const zoomed = anchorTransform(origin, middle, middle, 2, content, stage);
    expect(zoomed).toEqual({ scale: 2, x: -200, y: -150 });
    const over = anchorTransform(zoomed, { x: 0, y: 0 }, { x: 999, y: 999 }, 1, content, stage);
    expect(over.x).toBe(0);
    expect(over.y).toBe(0);
    const capped = anchorTransform(zoomed, { x: 0, y: 0 }, { x: 0, y: 0 }, 100, content, stage);
    expect(capped.scale).toBe(6);
  });

  it("finds the innermost region at a point and reveals a hidden box", () => {
    const regions = [
      { id: "big", box: [0, 0, 1000, 1000] as const },
      { id: "small", box: [400, 400, 500, 500] as const },
    ];
    expect(regionAt(regions, { x: 450, y: 450 })?.id).toBe("small");
    expect(regionAt(regions, { x: 10, y: 10 })?.id).toBe("big");
    const identity = { scale: 1, x: 0, y: 0 };
    expect(stageToBox({ x: 200, y: 150 }, identity, content)).toEqual({ x: 500, y: 500 });
    expect(stageToBox({ x: 500, y: 150 }, identity, content)).toBeNull();
    const view = revealBox({ scale: 3, x: 0, y: 0 }, [800, 800, 850, 850], content, stage);
    expect(view.x).toBeLessThan(0);
    expect(view.y).toBeLessThan(0);
  });
});

describe("ImageViewer", () => {
  it("zooms with + and -, resets with 0 and announces the level", () => {
    render(
      <ImageViewer
        pages={[{ src: "https://img.test/a.jpg" }]}
        page={0}
        onPageChange={vi.fn()}
        regions={[]}
        activeId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const stage = screen.getByRole("group", { name: t("rx.viewer.label") });
    expect(stage.getAttribute("data-scale")).toBe("1.000");
    fireEvent.keyDown(stage, { key: "+" });
    expect(stage.getAttribute("data-scale")).toBe("1.250");
    expect(screen.getByText("125%")).toBeTruthy();
    fireEvent.keyDown(stage, { key: "=" });
    expect(stage.getAttribute("data-scale")).toBe("1.563");
    fireEvent.keyDown(stage, { key: "-" });
    fireEvent.keyDown(stage, { key: "0" });
    expect(stage.getAttribute("data-scale")).toBe("1.000");
  });

  it("draws the active region, switches pages and shows the deleted note", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <ImageViewer
        pages={[{ src: "https://img.test/a.jpg" }, { src: "https://img.test/b.jpg" }]}
        page={0}
        onPageChange={onPageChange}
        regions={[
          { id: "item-0", page: 0, box: [10, 10, 100, 200], label: "x" },
          { id: "item-1", page: 1, box: [10, 10, 100, 200], label: "y" },
        ]}
        activeId="item-0"
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-region-id="item-0"]')?.getAttribute("data-active")).toBe(
      "true",
    );
    rerender(
      <ImageViewer
        pages={[{ src: "https://img.test/a.jpg" }, { src: null, deleted: true }]}
        page={1}
        onPageChange={onPageChange}
        regions={[]}
        activeId={null}
        onHover={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(t("rx.image.deleted"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("rx.viewer.page", { n: 1 }) }));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});

describe("CandidatePicker", () => {
  const candidates = [
    { id: "d1", name: "Augmentin", strength: "1 g", form: "tablet" },
    { id: "d2", name: "Augmentin", strength: "625 mg", withdrawn: true },
  ];

  function open(onCorrect = vi.fn()) {
    render(
      <CandidatePicker
        open
        onOpenChange={vi.fn()}
        rawText="Augmntin"
        candidates={candidates}
        onCorrect={onCorrect}
      />,
    );
    return onCorrect;
  }

  it("shows the raw text and candidates, and one tap corrects (consent off by default)", () => {
    const onCorrect = open();
    expect(screen.getByTestId("picker-raw").textContent).toBe("Augmntin");
    expect(screen.getByText(/625 mg/)).toBeTruthy();
    expect(screen.getByText(t("rx.picker.withdrawn"))).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: /Augmentin/ })[0]!);
    expect(onCorrect).toHaveBeenCalledWith({ candidateId: "d1", consentForEval: false });
  });

  it("sends the consent when checked and free text for none of these", () => {
    const onCorrect = open();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: t("rx.picker.none") }));
    fireEvent.change(screen.getByLabelText(t("rx.picker.freeText")), {
      target: { value: " Zyrtec " },
    });
    fireEvent.click(screen.getByRole("button", { name: t("rx.picker.save") }));
    expect(onCorrect).toHaveBeenCalledWith({ text: "Zyrtec", consentForEval: true });
  });
});

describe("RxTable without the drug database", () => {
  const unmatched = (over: Partial<RxTableItem> = {}) =>
    item({ matchedDrugId: null, activeIngredients: [], ...over });

  it("shows the model's name and no 'unconfirmed' badge on a confident line", () => {
    table([unmatched()], { modelOnly: true });
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText("Augmentin")).toBeTruthy();
    expect(within(row).queryByText(t("rx.unmatched"))).toBeNull();
    expect(within(row).getByText(t("rx.badge.high"))).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /راجع/ })).toBeNull();
  });

  it("still asks for a look at a medium line", () => {
    table([unmatched({ badge: "medium" })], { modelOnly: true });
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByRole("button", { name: /راجع/ })).toBeTruthy();
  });

  it("with the database an unmatched line is still unconfirmed", () => {
    table([unmatched()]);
    const row = screen.getAllByRole("row")[1]!;
    expect(within(row).getByText(t("rx.unmatched"))).toBeTruthy();
  });
});

describe("RxTable details", () => {
  const details = {
    purpose: "يُستخدم عادةً لخفض الحرارة",
    sideEffects: ["غثيان"],
    precautions: ["راجع الطبيب في الحمل"],
  };

  it("has no details button without details", () => {
    table([item()]);
    expect(screen.queryByRole("button", { name: /تفاصيل/ })).toBeNull();
  });

  it("opens and closes the details under the row, announcing the state", () => {
    table([item({ details })]);
    const button = screen.getByRole("button", {
      name: t("rx.item.detailsLabel", { name: "Augmentin" }),
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("rx-item-details")).toBeNull();

    fireEvent.click(button);
    expect(screen.getByTestId("rx-item-details").textContent).toContain(details.purpose);
    expect(screen.getByText("غثيان")).toBeTruthy();
    expect(screen.getByText(t("rx.details.note"))).toBeTruthy();
    const open = screen.getByRole("button", {
      name: t("rx.item.hideDetailsLabel", { name: "Augmentin" }),
    });
    expect(open.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(open);
    expect(screen.queryByTestId("rx-item-details")).toBeNull();
  });

  it("says so when the model had nothing to say about a medicine", () => {
    table([item({ details: { purpose: null, sideEffects: [], precautions: [] } })]);
    fireEvent.click(screen.getByRole("button", { name: /تفاصيل/ }));
    expect(screen.getByText(t("rx.details.none"))).toBeTruthy();
  });
});
