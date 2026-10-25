import { QUALITY_GATE_IDS } from "@wasfa/shared/content/constants";
import { ar, t } from "@wasfa/shared/i18n";
import { type Category, type ContentItemSummary } from "@wasfa/shared/schemas/content";
import { MEDIA_MAX_BYTES, type MediaAsset } from "@wasfa/shared/schemas/media";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  agendaDays,
  buildCalendarEntries,
  entriesByDay,
  gridRange,
  publishedQuery,
  scheduledQuery,
} from "../src/lib/content-calendar";
import {
  bulkErrorMessage,
  clearFiltersPatch,
  contentRowsToCsv,
  csvCell,
  csvRow,
  hasExtraFilters,
  isSavedViewActive,
  readContentFilters,
  savedViewPatch,
  savedViews,
  summariseBulk,
} from "../src/lib/content-list-model";
import { isHttpsUrl, personBody, plainExcerpt } from "../src/lib/content-people";
import {
  categoryRows,
  canHaveParent,
  moveSibling,
  parentCandidates,
} from "../src/lib/content-taxonomy";
import {
  addDays,
  dayKey,
  monthGrid,
  shiftMonth,
  startOfWeek,
  timeKey,
  weekStartFor,
  zonedLocalToInstant,
} from "../src/lib/content-time";
import { focalFromKey, focalFromPointer } from "../src/lib/media-focal";
import { matchesMediaSearch } from "../src/lib/media-search";
import { pollAsset, precheckFile, sha256Hex } from "../src/lib/media-upload-client";
import { mergeFirstPage } from "../src/lib/use-media-list";

const CAIRO = "Africa/Cairo";

/** Fails a test from inside an expression (no `!` assertions in this repo). */
function fail(): never {
  throw new Error("expected value is missing");
}

function item(overrides: Partial<ContentItemSummary> = {}): ContentItemSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    type: "article",
    locale: "ar",
    slug: "a",
    status: "draft",
    live: false,
    title: "عنوان",
    category: null,
    author: null,
    reviewer: null,
    source: "editor",
    apiKeyName: null,
    scheduledAt: null,
    publishedAt: null,
    updatedAt: "2026-10-24T10:00:00.000Z",
    wordCount: 700,
    requiresReview: true,
    issues: { block: 0, warn: 0 },
    reviewOverdue: false,
    ...overrides,
  };
}

describe("content time", () => {
  it("places an instant on the zone's calendar day, across the UTC midnight", () => {
    // 22:30 UTC on the 24th is 01:30 on the 25th in Cairo (UTC+3 in October).
    expect(dayKey("2026-10-24T22:30:00.000Z", CAIRO)).toBe("2026-10-25");
    expect(timeKey("2026-10-24T22:30:00.000Z", CAIRO)).toBe("01:30");
    expect(dayKey("2026-10-24T20:30:00.000Z", CAIRO)).toBe("2026-10-24");
  });

  it("turns a wall-clock time in the zone into the right instant, winter and summer", () => {
    expect(zonedLocalToInstant("2026-01-15T09:00", CAIRO)?.toISOString()).toBe(
      "2026-01-15T07:00:00.000Z",
    );
    expect(zonedLocalToInstant("2026-07-15T09:00", CAIRO)?.toISOString()).toBe(
      "2026-07-15T06:00:00.000Z",
    );
    expect(zonedLocalToInstant("not a date", CAIRO)).toBeNull();
  });

  it("does day arithmetic and week starts (Saturday for Arabic)", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekStartFor("ar")).toBe(6);
    expect(weekStartFor("en")).toBe(0);
    // 2026-10-01 is a Thursday; the Saturday on or before it is 26 September.
    expect(startOfWeek("2026-10-01", 6)).toBe("2026-09-26");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("builds a month grid of whole weeks starting on the week start", () => {
    const weeks = monthGrid("2026-10", 6);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe("2026-09-26");
    expect(weeks.at(-1)?.[6]).toBe("2026-11-06");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
});

describe("calendar model", () => {
  it("groups scheduled and published items by zone day and ignores days outside the grid", () => {
    const scheduled = item({
      id: "s1",
      status: "scheduled",
      scheduledAt: "2026-10-24T22:30:00.000Z",
    });
    const published = item({
      id: "p1",
      live: true,
      status: "published",
      publishedAt: "2026-10-10T08:00:00.000Z",
    });
    const outside = item({ id: "o1", live: true, publishedAt: "2026-05-01T08:00:00.000Z" });
    const entries = buildCalendarEntries([scheduled], [published, outside], CAIRO, "2026-10", 6);
    expect(entries.map((entry) => [entry.item.id, entry.kind, entry.day])).toEqual([
      ["p1", "published", "2026-10-10"],
      ["s1", "scheduled", "2026-10-25"],
    ]);
    const byDay = entriesByDay(entries);
    expect(byDay.get("2026-10-25")?.[0]?.item.id).toBe("s1");
    expect(agendaDays(entries, "2026-10")).toEqual(["2026-10-10", "2026-10-25"]);
  });

  it("asks the API for the grid range with a day of slack on both sides", () => {
    expect(gridRange("2026-10", 6)).toEqual({ first: "2026-09-26", last: "2026-11-06" });
    expect(scheduledQuery("2026-10", 6)).toEqual({
      scheduledFrom: "2026-09-25",
      scheduledTo: "2026-11-07",
    });
    expect(publishedQuery("2026-10", 6)).toEqual({
      publishedFrom: "2026-09-25",
      publishedTo: "2026-11-07",
    });
  });
});

describe("content list model", () => {
  it("reads filters from the URL and sends toggles only when set", () => {
    const params = new URLSearchParams("type=article&status=draft&live=true&hasIssues=false&q=x");
    const filters = readContentFilters((name) => params.get(name) ?? "");
    expect(filters["status"]).toBe("draft");
    expect(filters["live"]).toBe("true");
    // "false" would coerce to true in the API, so it is never forwarded.
    expect(filters["hasIssues"]).toBe("");
    expect(hasExtraFilters(filters)).toBe(true);
    expect(hasExtraFilters({ type: "article", status: "" })).toBe(false);
  });

  it("builds the saved views and the URL patch each applies", () => {
    const views = savedViews({ today: "2026-10-24", myPersonId: null });
    expect(views.map((view) => view.id)).toEqual([
      "inReview",
      "scheduledThisWeek",
      "reviewOverdue",
      "apiToday",
    ]);
    const week = views.find((view) => view.id === "scheduledThisWeek");
    expect(week?.params).toEqual({
      status: "scheduled",
      scheduledFrom: "2026-10-24",
      scheduledTo: "2026-10-30",
    });
    const mine = savedViews({ today: "2026-10-24", myPersonId: "p-1" }).find(
      (view) => view.id === "mine",
    );
    expect(mine?.params).toEqual({ status: "draft", authorId: "p-1" });
    const patch = savedViewPatch(views.find((view) => view.id === "inReview") ?? fail());
    expect(patch["status"]).toBe("in_review");
    // Applying a view clears the other filters but keeps the nav-link type.
    expect(patch["q"]).toBeNull();
    expect("type" in patch).toBe(false);
    expect("type" in clearFiltersPatch()).toBe(false);
  });

  it("knows which saved view is active", () => {
    const inReview =
      savedViews({ today: "2026-10-24", myPersonId: null }).find(
        (view) => view.id === "inReview",
      ) ?? fail();
    expect(isSavedViewActive(inReview, { type: "guide", status: "in_review", q: "" })).toBe(true);
    expect(isSavedViewActive(inReview, { type: "", status: "in_review", q: "x" })).toBe(false);
  });

  it("defuses formula cells in the CSV and quotes what needs it", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe("");
    expect(csvRow(["a", 1, true])).toBe("a,1,true\r\n");
  });

  it("writes the rows of the list as a CSV, capped at 1000", () => {
    const csv = contentRowsToCsv([item({ title: "=1+1", category: { id: "c", name: "تصنيف" } })]);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toContain("id,type,locale,slug,title");
    expect(lines[1]).toContain("'=1+1");
    expect(lines[1]).toContain("تصنيف");
    const many = Array.from({ length: 1200 }, (_, index) => item({ id: `id-${String(index)}` }));
    expect(contentRowsToCsv(many).trim().split("\r\n")).toHaveLength(1001);
  });

  it("summarises bulk results and maps codes to messages", () => {
    const summary = summariseBulk([
      { id: "a", ok: true },
      { id: "b", ok: false, code: "CONTENT_GATES_BLOCK" },
    ]);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed.map((entry) => entry.id)).toEqual(["b"]);
    expect(bulkErrorMessage("CONTENT_GATES_BLOCK")).toBe(
      t("admin.content.error.CONTENT_GATES_BLOCK"),
    );
    // An error code without screen wording falls back to the API's message, then to the generic one.
    expect(bulkErrorMessage("RATE_LIMITED")).toBe(t("error.RATE_LIMITED"));
    expect(bulkErrorMessage("some_gate_id")).toBe(t("admin.content.error.unknown"));
    expect(bulkErrorMessage(undefined)).toBe(t("admin.content.error.unknown"));
  });
});

describe("content strings", () => {
  it("explains every quality gate", () => {
    for (const id of QUALITY_GATE_IDS) {
      expect(Object.hasOwn(ar, `admin.content.gate.${id}`), id).toBe(true);
    }
  });
});

function category(id: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    parentId: null,
    slugAr: id,
    slugEn: null,
    nameAr: id,
    nameEn: null,
    descriptionAr: "",
    descriptionEn: "",
    requiresMedicalReview: true,
    defaultReviewerId: null,
    seoTitleAr: "",
    seoDescriptionAr: "",
    seoTitleEn: "",
    seoDescriptionEn: "",
    sort: 0,
    itemCount: 0,
    ...overrides,
  };
}

describe("categories tree", () => {
  const list = [
    category("b", { sort: 2 }),
    category("a", { sort: 1 }),
    category("a2", { parentId: "a", sort: 2 }),
    category("a1", { parentId: "a", sort: 1 }),
    category("orphan", { parentId: "missing", sort: 3 }),
  ];

  it("orders parents by sort and puts each parent's children right after it", () => {
    const rows = categoryRows(list);
    expect(rows.map((row) => [row.category.id, row.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a2", 1],
      ["b", 0],
      ["orphan", 0],
    ]);
    expect(rows[1]?.siblings).toEqual(["a1", "a2"]);
    expect(rows[3]?.index).toBe(1);
  });

  it("moves one sibling up or down and stays put at the edges", () => {
    expect(moveSibling(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveSibling(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveSibling(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveSibling(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
  });

  it("offers only top-level parents and never a parent for a category that has children", () => {
    expect(parentCandidates(list, "a").map((entry) => entry.id)).toEqual(
      ["b", "orphan"].filter((id) => id !== "orphan"),
    );
    expect(canHaveParent(list, "a")).toBe(false);
    expect(canHaveParent(list, "b")).toBe(true);
    expect(canHaveParent(list, null)).toBe(true);
  });
});

describe("people helpers", () => {
  it("strips markdown to a plain excerpt cut at a word", () => {
    expect(plainExcerpt("## عنوان\n\nنص **غامق** و[رابط](https://x.y) والقائمة\n- بند")).toBe(
      "عنوان نص غامق ورابط والقائمة بند",
    );
    const long = `${"كلمة ".repeat(100)}`;
    const cut = plainExcerpt(long, 50);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(51);
  });

  it("accepts https links only", () => {
    expect(isHttpsUrl("https://scholar.google.com/x")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("example.com")).toBe(false);
  });

  it("rebuilds a person request body with one field changed", () => {
    const body = personBody(
      {
        id: "i",
        itemCount: 3,
        slug: "dr-x",
        nameAr: "د. س",
        nameEn: null,
        role: "reviewer",
        credentialsAr: "",
        credentialsEn: "",
        licenceNumber: "123",
        showLicence: false,
        bioMdAr: "",
        bioMdEn: "",
        photoMediaId: null,
        sameAs: [],
        userId: null,
        active: true,
      },
      { active: false },
    );
    expect(body.active).toBe(false);
    expect(body.licenceNumber).toBe("123");
    expect("itemCount" in body).toBe(false);
  });
});

describe("focal point", () => {
  it("turns a pointer position into percents, clamped to the box", () => {
    const box = { left: 100, top: 50, width: 200, height: 100 };
    expect(focalFromPointer({ clientX: 200, clientY: 100 }, box)).toEqual({ x: 50, y: 50 });
    expect(focalFromPointer({ clientX: 50, clientY: 400 }, box)).toEqual({ x: 0, y: 100 });
    expect(focalFromPointer({ clientX: 1, clientY: 1 }, { ...box, width: 0 })).toEqual({
      x: 50,
      y: 50,
    });
  });

  it("moves with the arrow keys, ten at a time with Shift, and recentres on Home", () => {
    expect(focalFromKey({ x: 50, y: 50 }, "ArrowRight", false)).toEqual({ x: 51, y: 50 });
    expect(focalFromKey({ x: 50, y: 50 }, "ArrowUp", true)).toEqual({ x: 50, y: 40 });
    expect(focalFromKey({ x: 0, y: 100 }, "ArrowLeft", true)).toEqual({ x: 0, y: 100 });
    expect(focalFromKey({ x: 3, y: 3 }, "Home", false)).toEqual({ x: 50, y: 50 });
    expect(focalFromKey({ x: 3, y: 3 }, "a", false)).toBeNull();
  });
});

const asset = (overrides: Partial<MediaAsset> = {}): MediaAsset => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  sha256: "a".repeat(64),
  status: "processing",
  mime: "image/png",
  width: null,
  height: null,
  bytes: 10,
  focalX: 50,
  focalY: 50,
  altAr: null,
  altEn: null,
  blurDataUrl: null,
  variants: [],
  rejectReason: null,
  originalFilename: "scan.png",
  seoFilename: null,
  caption: null,
  credit: null,
  licence: "own",
  licenceRef: null,
  warnings: [],
  usageCount: 0,
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
  ...overrides,
});

describe("media search and list merge", () => {
  it("searches alt text, caption and file names, case-insensitively", () => {
    const sample = asset({
      altAr: "وصفة طبية",
      altEn: "Prescription",
      originalFilename: "IMG_001.png",
    });
    expect(matchesMediaSearch(sample, "وصفة")).toBe(true);
    expect(matchesMediaSearch(sample, "prescr")).toBe(true);
    expect(matchesMediaSearch(sample, "img_001")).toBe(true);
    expect(matchesMediaSearch(sample, "xyz")).toBe(false);
    expect(matchesMediaSearch(sample, "  ")).toBe(true);
  });

  it("merges a fresh first page: known ids update in place, new ones come first", () => {
    const old = [asset({ id: "1" }), asset({ id: "2" })];
    const merged = mergeFirstPage(old, [asset({ id: "3" }), asset({ id: "1", status: "ready" })]);
    expect(merged.map((entry) => entry.id)).toEqual(["3", "1", "2"]);
    expect(merged[1]?.status).toBe("ready");
  });
});

describe("media upload client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pre-checks type and size before any request", () => {
    expect(precheckFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(precheckFile({ type: "image/gif", size: 1000 })).toBe("unsupported_type");
    expect(precheckFile({ type: "application/pdf", size: 1000 })).toBe("unsupported_type");
    expect(precheckFile({ type: "image/jpeg", size: MEDIA_MAX_BYTES + 1 })).toBe("too_large");
    expect(precheckFile({ type: "image/jpeg", size: MEDIA_MAX_BYTES })).toBeNull();
    expect(precheckFile({ type: "image/webp", size: 0 })).toBe("empty");
  });

  it("hashes with SHA-256 as lower-case hex", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("polls until the asset settles, and keeps going through a transient read failure", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn<() => Promise<MediaAsset>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(asset({ status: "processing" }))
      .mockResolvedValueOnce(asset({ status: "ready" }));
    const result = pollAsset(asset(), load, { intervalMs: 1000, timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ kind: "settled", asset: { status: "ready" } });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("gives up with a timeout state when processing never ends", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn<() => Promise<MediaAsset>>()
      .mockResolvedValue(asset({ status: "processing" }));
    const result = pollAsset(asset(), load, { intervalMs: 1000, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toMatchObject({ kind: "timeout" });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("settles at once for an asset that is already ready (dedupe)", async () => {
    const load = vi.fn<() => Promise<MediaAsset>>();
    expect(await pollAsset(asset({ status: "ready" }), load)).toMatchObject({ kind: "settled" });
    expect(load).not.toHaveBeenCalled();
  });
});
