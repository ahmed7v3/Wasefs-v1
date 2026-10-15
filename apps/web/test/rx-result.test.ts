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
  const options = { siteUrl: "https://wasfa.online", reportDate: "15 أكتوبر 2026" };
  const details = {
    purpose: "يُستخدم عادةً لخفض الحرارة",
    sideEffects: ["غثيان", "دوخة"],
    precautions: ["راجع الطبيب في الحمل"],
  };
  const overview = {
    summary: "أدوية تُستخدم عادةً لاضطرابات هرمونية.",
    likelyConditions: ["قد يُستخدم في ارتفاع البرولاكتين"],
  };

  it("carries the lines and no notes or raw text of matched lines, and ends with the site link", () => {
    const items = [
      line(),
      line({ matchedDrugId: null, rawText: "Zyrt?", name: null, badge: "medium" }),
    ];
    const report = { items };
    for (const text of [buildCopyText(report, options), buildShareText(report, options)]) {
      expect(text).toContain("1. Augmentin");
      expect(text).toContain("2. Zyrt?");
      expect(text).toContain(t("rx.share.review"));
      expect(text).not.toContain("Ahmed");
      expect(text).not.toContain("0100");
      // The only link is the site's own.
      expect(text.match(/https?:\/\/\S+/g)).toEqual(["https://wasfa.online"]);
      expect(text.trimEnd().endsWith("https://wasfa.online")).toBe(true);
    }
    expect(buildCopyText(report, options)).toContain(t("rx.disclaimer"));
    const url = whatsappShareUrl(buildShareText(report, options));
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf("=") + 1))).toBe(
      buildShareText(report, options),
    );
  });

  it("the share is WhatsApp-formatted and short; the copy is plain and complete", () => {
    const report = {
      items: [line({ activeIngredients: ["amoxicillin"], details })],
      overview,
      date: "13/12/2025",
    };
    const share = buildShareText(report, options);
    const copy = buildCopyText(report, options);
    expect(share).toContain("*1. Augmentin*");
    expect(share).toContain(t("rx.share.purpose", { value: details.purpose }));
    expect(share).not.toContain("غثيان");
    expect(share).toContain(t("rx.share.reportDate", { date: options.reportDate }));
    expect(share).toContain(t("rx.share.rxDate", { date: "13/12/2025" }));
    expect(share).toContain(overview.summary);
    expect(share).toContain(t("rx.share.cta", { url: options.siteUrl }));
    expect(copy).not.toContain("*1. Augmentin*");
    expect(copy).toContain("1. Augmentin");
    expect(copy).toContain(t("rx.share.sideEffects", { value: "غثيان؛ دوخة" }));
    expect(copy).toContain(t("rx.share.precautions", { value: "راجع الطبيب في الحمل" }));
  });

  it("without the database nothing is 'unconfirmed' and a confident line has no review mark", () => {
    const items = [
      line({ matchedDrugId: null, rawText: "Dostenix", name: "Dostinex", badge: "high" }),
    ];
    const text = buildShareText({ items, matching: "model" }, options);
    expect(text).toContain("*1. Dostinex*");
    expect(text).not.toContain(t("rx.share.review"));
    expect(text).not.toContain(t("rx.share.unconfirmed"));
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
