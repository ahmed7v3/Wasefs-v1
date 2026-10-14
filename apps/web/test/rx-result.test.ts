import { t } from "@wasfa/shared/i18n";
import { describe, expect, it } from "vitest";

import { optimisticDrugCorrection } from "../src/lib/rx-optimistic";
import {
  MAX_RECONNECTS,
  elapsedSeconds,
  initialProgress,
  progressReducer,
  reconnectDelayMs,
} from "../src/lib/rx-progress";
import { buildCopyText, buildShareText, whatsappShareUrl } from "../src/lib/rx-text";

import type { RxResultItem } from "@wasfa/shared/schemas/rx";

describe("progress reducer", () => {
  it("moves forward on newer steps and ignores replays", () => {
    let s = initialProgress("queued");
    s = progressReducer(s, { type: "event", event: { type: "step", step: "match", seq: 2 } });
    expect(s.step).toBe(1);
    s = progressReducer(s, { type: "event", event: { type: "step", step: "read", seq: 1 } });
    expect(s.step).toBe(1);
    s = progressReducer(s, { type: "event", event: { type: "step", step: "verify", seq: 3 } });
    expect(s.step).toBe(2);
  });

  it("falls back to polling after repeated drops and goes back on resume", () => {
    let s = initialProgress("processing");
    for (let i = 0; i < MAX_RECONNECTS - 1; i += 1) s = progressReducer(s, { type: "dropped" });
    expect(s.transport).toBe("sse");
    s = progressReducer(s, { type: "dropped" });
    expect(s.transport).toBe("polling");
    s = progressReducer(s, { type: "resume" });
    expect(s).toMatchObject({ transport: "sse", attempts: 0, epoch: 1 });
    expect(reconnectDelayMs(0)).toBe(0);
    expect(reconnectDelayMs(2)).toBe(2000);
  });

  it("a replayed event proves the stream alive; terminal states are final", () => {
    let s = initialProgress("processing");
    s = progressReducer(s, { type: "event", event: { type: "step", step: "match", seq: 4 } });
    s = progressReducer(s, { type: "dropped" });
    s = progressReducer(s, { type: "event", event: { type: "step", step: "match", seq: 4 } });
    expect(s.attempts).toBe(0);
    s = progressReducer(s, { type: "event", event: { type: "done", status: "refunded", seq: 5 } });
    expect(s.phase).toBe("refunded");
    s = progressReducer(s, { type: "snapshot", status: "processing", errorRef: null });
    expect(s.phase).toBe("refunded");
  });

  it("takes the end state from a snapshot of the row (polling)", () => {
    let s = initialProgress("queued");
    s = progressReducer(s, { type: "snapshot", status: "verifying", errorRef: null });
    expect(s.step).toBe(2);
    s = progressReducer(s, { type: "snapshot", status: "failed", errorRef: "WSF-ABCD-2345" });
    expect(s).toMatchObject({ phase: "failed", errorRef: "WSF-ABCD-2345" });
    expect(elapsedSeconds("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:01:05Z"))).toBe(65);
  });
});

const line = (over: Partial<RxResultItem> = {}): RxResultItem => ({
  rawText: "Patient Ahmed Augmentin",
  name: "Augmentin",
  matchedDrugId: "00000000-0000-4000-8000-000000000001",
  matchScore: 0.9,
  activeIngredients: [],
  strength: "1 g",
  form: "tablet",
  dose: null,
  frequency: "3 مرات يوميًا",
  duration: "7 أيام",
  route: null,
  notes: "Ahmed Hassan 0100",
  confidence: 0.9,
  badge: "high",
  verified: "not_needed",
  box_2d: null,
  page: 0,
  ...over,
});

describe("copy and share text", () => {
  it("carries the lines and no notes, raw text of matched lines or image", () => {
    const items = [
      line(),
      line({ matchedDrugId: null, rawText: "Zyrt?", name: null, badge: "medium" }),
    ];
    for (const text of [buildCopyText(items), buildShareText(items)]) {
      expect(text).toContain("1. Augmentin");
      expect(text).toContain(`2. Zyrt? (${t("rx.share.unconfirmed")})`);
      expect(text).not.toContain("Ahmed");
      expect(text).not.toContain("0100");
      expect(text).not.toMatch(/https?:/);
    }
    expect(buildCopyText(items)).toContain(t("rx.disclaimer"));
    const url = whatsappShareUrl(buildShareText(items));
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf("=") + 1))).toBe(buildShareText(items));
  });
});

describe("optimistic correction", () => {
  it("a picked drug is high; typed text stays below high", () => {
    const picked = optimisticDrugCorrection(line({ badge: "low", confidence: 0.3 }), {
      kind: "candidate",
      drugId: "00000000-0000-4000-8000-000000000002",
      name: "Panadol",
    });
    expect(picked).toMatchObject({ name: "Panadol", badge: "high", verified: "corrected" });
    const typed = optimisticDrugCorrection(line({ confidence: 0.95 }), {
      kind: "text",
      text: "Zyrtec",
    });
    expect(typed).toMatchObject({ matchedDrugId: null, name: "Zyrtec", badge: "medium" });
  });
});
