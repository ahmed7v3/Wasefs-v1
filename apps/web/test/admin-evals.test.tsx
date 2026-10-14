// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvalsReviewPanel } from "../src/components/admin/evals-review-panel";
import { EvalsRunsPanel } from "../src/components/admin/evals-runs-panel";
import {
  formatDeltaPoints,
  formatRatio,
  formatSeconds,
  formatUsdMicros,
} from "../src/lib/eval-format";
import { ReauthProvider } from "../src/lib/reauth";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const SET = "33333333-3333-4333-8333-333333333333";
const MODEL = "44444444-4444-4444-8444-444444444444";
const CORRECTION = "55555555-5555-4555-8555-555555555555";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <ReauthProvider>{ui}</ReauthProvider>
    </ToastProvider>,
  );

const group = {
  items: 2,
  failed: 0,
  expected: 4,
  predicted: 4,
  detected: 4,
  nameCorrect: 3,
  nameAccuracy: 0.75,
  recall: 1,
  strength: { labelled: 2, correct: 2, accuracy: 1 },
  frequency: { labelled: 0, correct: 0, accuracy: null },
  duration: { labelled: 0, correct: 0, accuracy: null },
  fabricated: 0,
  fabricationRate: 0,
  calibration: [],
  costUsdMicros: 12_345,
  latencyP50Ms: 8_000,
  latencyP95Ms: 12_000,
};

const run = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  setId: SET,
  setKey: "owner-set",
  setName: "Owner set",
  status: "done",
  snapshot: null,
  modelName: name,
  metrics: { score: 75, overall: group, printed: group, handwritten: group },
  costUsdMicros: 12_345,
  itemsTotal: 2,
  itemsDone: 2,
  startedBy: null,
  createdAt: "2026-10-14T10:00:00.000Z",
  startedAt: "2026-10-14T10:00:01.000Z",
  finishedAt: "2026-10-14T10:05:00.000Z",
  ...over,
});

describe("eval format helpers", () => {
  const ratios: [number | null, string][] = [
    [null, "—"],
    [1, "100%"],
    [0.9487, "94.9%"],
    [0, "0%"],
  ];
  it.each(ratios)("formatRatio(%s)", (ratio, text) => {
    expect(formatRatio(ratio)).toBe(text);
  });

  const deltas: [number | null, number | null, string][] = [
    [0.9, 0.925, "+2.5"],
    [0.9, 0.85, "−5"],
    [0.9, 0.9, "0"],
    [null, 0.9, "—"],
  ];
  it.each(deltas)("formatDeltaPoints(%s, %s)", (a, b, text) => {
    expect(formatDeltaPoints(a, b)).toBe(text);
  });

  it("formats cost and latency without float surprises", () => {
    expect(formatUsdMicros(12_345)).toBe("$0.0123");
    expect(formatUsdMicros(0)).toBe("$0.0000");
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(8_000)).toContain("8");
  });
});

describe("EvalsRunsPanel", () => {
  it("lists runs, enables comparison only for two picked runs, and shows the comparison table", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/runs/compare")) {
        return Promise.resolve(
          json({
            a: run(RUN_A, "Model A"),
            b: run(RUN_B, "Model B", {
              metrics: {
                score: 80,
                overall: { ...group, nameAccuracy: 0.8 },
                printed: group,
                handwritten: group,
              },
            }),
            sameSet: true,
            differences: [],
          }),
        );
      }
      return Promise.resolve(json({ items: [run(RUN_A, "Model A"), run(RUN_B, "Model B")] }));
    });
    const user = userEvent.setup();
    wrap(<EvalsRunsPanel />);

    expect(await screen.findByText("Model A")).toBeTruthy();
    const compare = screen.getByRole("button", { name: t("admin.evals.runs.compare") });
    expect((compare as HTMLButtonElement).disabled).toBe(true);

    await user.click(
      screen.getByRole("checkbox", { name: t("admin.evals.runs.pick", { name: "Model A" }) }),
    );
    expect((compare as HTMLButtonElement).disabled).toBe(true);
    await user.click(
      screen.getByRole("checkbox", { name: t("admin.evals.runs.pick", { name: "Model B" }) }),
    );
    expect((compare as HTMLButtonElement).disabled).toBe(false);
    await user.click(compare);

    const table = await screen.findByRole("table", { name: t("admin.evals.compare.title") });
    // 75% vs 80% name accuracy: +5 points in the overall block.
    expect(within(table).getAllByText("+5").length).toBeGreaterThan(0);
  });

  it("shows the empty state and the 403 state calmly", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    const first = wrap(<EvalsRunsPanel />);
    expect(await screen.findByText(t("admin.evals.runs.empty"))).toBeTruthy();
    first.unmount();

    fetchMock.mockResolvedValueOnce(json({ code: "FORBIDDEN", message: "no" }, 403));
    wrap(<EvalsRunsPanel />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("EvalsReviewPanel", () => {
  const item = {
    correctionId: CORRECTION,
    field: "drug",
    itemName: "Augmentin",
    before: "Augmentn",
    after: "Augmentin",
    imageAvailable: true,
    createdAt: "2026-10-14T10:00:00.000Z",
  };

  it("approves into a chosen set and rejects by withdrawing consent", async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/review-queue") && (init?.method ?? "GET") === "GET") {
        return Promise.resolve(json({ items: [item] }));
      }
      if (url.endsWith("/evals/sets")) {
        return Promise.resolve(
          json({
            items: [
              {
                id: SET,
                key: "owner-set",
                name: "Owner set",
                description: null,
                items: 1,
                printed: 1,
                handwritten: 0,
                withoutImage: 0,
                createdAt: "2026-10-14T10:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/approve"))
        return Promise.resolve(json({ itemId: MODEL, imageCopied: true }));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const user = userEvent.setup();
    wrap(<EvalsReviewPanel />);

    // Item text only: the queue shows the line, before and after, nothing else.
    expect(await screen.findByText("Augmentn")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("admin.evals.review.approve") }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", { name: t("admin.evals.review.approve") }),
    );

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/approve"));
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        correctionId: CORRECTION,
        setId: SET,
        kind: "printed",
      });
    });

    await user.click(screen.getByRole("button", { name: t("admin.evals.review.reject") }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/reject"));
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ correctionId: CORRECTION });
    });
  });
});
