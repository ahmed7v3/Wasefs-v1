// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptModal } from "../src/components/growth/prompt-modal";
import { setGrowthBusy } from "../src/lib/growth-busy";
import { trackGrowth } from "../src/lib/growth-events";

import type { GrowthPrompt } from "@wasfa/shared/schemas/growth";

vi.mock("../src/lib/growth-events", () => ({
  trackGrowth: vi.fn(),
  growthSessionId: () => "session-12345",
}));

const track = vi.mocked(trackGrowth);

const PROMPT: GrowthPrompt = {
  kind: "trial_ended",
  variant: "a",
  messageKey: "growth.prompt.trial_ended.a",
  params: {},
  cta: { kind: "pricing", href: "/pricing" },
  form: "modal",
  secondaryHref: "/billing#packs",
  content: {
    ar: {
      title: "خلصت تجربتك المجانية",
      body: "مع باقة برو تقدر تحلل 200 روشتة في الشهر بـ 299 ج.م بس.",
      cta: "اشترك في برو",
      secondary: "اشتري رصيد إضافي",
      close: "مش دلوقتي",
    },
    en: { title: "Trial over", body: "Body", cta: "Subscribe", close: "Not now" },
  },
};

beforeEach(() => {
  track.mockReset();
  setGrowthBusy(false);
});

afterEach(() => {
  setGrowthBusy(false);
});

describe("PromptModal", () => {
  it("opens a labelled dialog with the rendered copy and reports it as shown", () => {
    render(<PromptModal prompt={PROMPT} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "خلصت تجربتك المجانية" });
    expect(dialog).toHaveProperty("open", true);
    expect(dialog.textContent).toContain("200 روشتة");
    expect(screen.getByTestId("prompt-cta").getAttribute("href")).toBe("/pricing");
    expect(screen.getByTestId("prompt-secondary").getAttribute("href")).toBe("/billing#packs");
    expect(track).toHaveBeenCalledWith("prompt_shown", { kind: "trial_ended", form: "modal" }, true);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("closes with one tap on the close text and reports a dismissal", async () => {
    const onClose = vi.fn();
    render(<PromptModal prompt={PROMPT} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "مش دلوقتي" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("prompt_dismissed", { kind: "trial_ended", form: "modal" }, true);
  });

  it("closes with the close icon", async () => {
    const onClose = vi.fn();
    render(<PromptModal prompt={PROMPT} onClose={onClose} />);
    const icons = screen.getAllByRole("button");
    // The platform dialog's own close icon is a labelled button as well as the close text.
    expect(icons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(screen.getByLabelText(/إغلاق|Close/));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape (the dialog's cancel event) and reports a dismissal once", () => {
    const onClose = vi.fn();
    render(<PromptModal prompt={PROMPT} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(track.mock.calls.filter(([name]) => name === "prompt_dismissed")).toHaveLength(1);
  });

  it("reports a click on the call to action", async () => {
    render(<PromptModal prompt={PROMPT} onClose={vi.fn()} />);
    await userEvent.click(screen.getByTestId("prompt-cta"));
    expect(track).toHaveBeenCalledWith(
      "prompt_clicked",
      { kind: "trial_ended", form: "modal", target: "primary" },
      true,
    );
  });

  it("never opens while an upload or an analysis is in progress, and does not report it", () => {
    setGrowthBusy(true);
    const onClose = vi.fn();
    render(<PromptModal prompt={PROMPT} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(track).not.toHaveBeenCalled();
    // The slot is told to forget it: no later surprise once the person is idle.
    expect(onClose).toHaveBeenCalled();
  });
});
