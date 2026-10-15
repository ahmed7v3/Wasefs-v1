// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RxRating } from "../src/components/rx/rx-rating";

const calls: { path: string; body: unknown }[] = [];

vi.mock("../src/lib/api-client", () => ({
  api: (path: string, options: { body: Record<string, unknown> }) => {
    calls.push({ path, body: options.body });
    return Promise.resolve({
      rating: options.body["rating"],
      shareForReview: options.body["shareForReview"],
    });
  },
}));

const ID = "00000000-0000-4000-8000-000000000001";

function mount(initial = { rating: null as "good" | "bad" | null, shareForReview: false }) {
  return render(
    <ToastProvider>
      <RxRating analysisId={ID} initial={initial} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
});

describe("RxRating", () => {
  it("rates in two steps and never shares unless the box is ticked", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: t("rx.rating.good") }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("checkbox");
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: t("rx.rating.send") }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({
      path: `/rx/${ID}/rating`,
      body: { rating: "good", note: undefined, shareForReview: false },
    });
    expect(await screen.findByText(t("rx.rating.saved"))).toBeTruthy();
  });

  it("sends the consent only when the person ticks it, with the note", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: t("rx.rating.bad") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "  القراءة ناقصة  " },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: t("rx.rating.send") }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({ rating: "bad", note: "القراءة ناقصة", shareForReview: true });
  });

  it("asks for consent afresh each time (never pre-ticked), even after sharing before", async () => {
    mount({ rating: "good", shareForReview: true });
    expect(screen.getByText(new RegExp(t("rx.rating.sharedYes")))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("rx.rating.bad") }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});
