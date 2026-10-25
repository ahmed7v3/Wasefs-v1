// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { ERROR_CODES } from "@wasfa/shared/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../src/lib/api-error";
import {
  derivePrimaryAction,
  overflowActions,
  canReviewNow,
} from "../src/lib/content-editor/actions";
import {
  AutosaveScheduler,
  pickRestoreOffer,
  readMirror,
  writeMirror,
  clearMirror,
  type AutosaveStatus,
} from "../src/lib/content-editor/autosave";
import { autosaveLabel } from "../src/lib/content-editor/autosave-label";
import { conflictFromError, resolveConflict } from "../src/lib/content-editor/conflict";
import {
  buildCreateBody,
  buildUpdateBody,
  emptyDraft,
  metaPatch,
  payloadPatch,
} from "../src/lib/content-editor/draft";
import {
  CONTENT_ERROR_KEYS,
  describeContentError,
  gateIdsFromError,
} from "../src/lib/content-editor/errors";
import {
  computeKeyboardInset,
  useKeyboardInset,
} from "../src/lib/content-editor/use-keyboard-inset";
import {
  formatZoned,
  minScheduleLocal,
  utcToZoned,
  zonedToUtc,
} from "../src/lib/content-editor/zoned-time";

import type { ContentItemDetail } from "@wasfa/shared/schemas/content";

describe("zoned time (Africa/Cairo, DST)", () => {
  const tz = "Africa/Cairo";

  it("converts winter (UTC+2) and summer (UTC+3) both ways", () => {
    expect(zonedToUtc("2026-01-15T10:00", tz)?.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(zonedToUtc("2026-07-15T10:00", tz)?.toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(utcToZoned("2026-01-15T08:00:00Z", tz)).toBe("2026-01-15T10:00");
    expect(utcToZoned(new Date("2026-07-15T07:00:00Z"), tz)).toBe("2026-07-15T10:00");
  });

  it("spring forward: the missing hour resolves to the same reading after the jump", () => {
    // Egypt moves 00:00 -> 01:00 on the last Friday of April (2026-04-24).
    expect(zonedToUtc("2026-04-23T23:30", tz)?.toISOString()).toBe("2026-04-23T21:30:00.000Z");
    expect(zonedToUtc("2026-04-24T01:30", tz)?.toISOString()).toBe("2026-04-23T22:30:00.000Z");
    const gap = zonedToUtc("2026-04-24T00:30", tz);
    expect(gap).not.toBeNull();
    expect(utcToZoned(gap as Date, tz)).toBe("2026-04-24T01:30");
  });

  it("fall back: the repeated hour resolves to its first occurrence", () => {
    // Clocks go back 24:00 -> 23:00 on the last Thursday of October (2026-10-29).
    const repeated = zonedToUtc("2026-10-29T23:30", tz);
    expect(repeated?.toISOString()).toBe("2026-10-29T20:30:00.000Z");
    expect(zonedToUtc("2026-10-30T00:30", tz)?.toISOString()).toBe("2026-10-29T22:30:00.000Z");
    expect(utcToZoned("2026-10-29T21:30:00Z", tz)).toBe("2026-10-29T23:30");
  });

  it("rejects malformed input and computes the schedule minimum", () => {
    expect(zonedToUtc("tomorrow", tz)).toBeNull();
    expect(minScheduleLocal(new Date("2026-01-15T08:00:30Z"), tz, 2)).toBe("2026-01-15T10:03");
    expect(formatZoned("2026-01-15T08:00:00Z", tz)).toMatch(/10/);
  });
});

describe("autosave scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initial = "a") {
    let snapshot: string | null = initial;
    let visible = true;
    const saved: string[] = [];
    const statuses: AutosaveStatus[] = [];
    let fail = false;
    const scheduler = new AutosaveScheduler(
      {
        now: () => Date.now(),
        isVisible: () => visible,
        snapshot: () => snapshot,
        save: (s) => {
          if (fail) return Promise.reject(new Error("offline"));
          saved.push(s);
          return Promise.resolve();
        },
        onStatus: (s) => statuses.push(s),
      },
      "a",
    );
    return {
      scheduler,
      saved,
      statuses,
      type: (s: string) => {
        snapshot = s;
        scheduler.notifyChange();
      },
      setVisible: (v: boolean) => (visible = v),
      setFail: (v: boolean) => (fail = v),
    };
  }

  it("saves once, 10 s after the first change, with the latest text", async () => {
    const t = setup();
    t.type("ab");
    await vi.advanceTimersByTimeAsync(5_000);
    t.type("abc");
    expect(t.saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.saved).toEqual(["abc"]);
    expect(t.statuses.map((s) => s.kind)).toEqual(["saving", "saved"]);
  });

  it("skips the save when the text equals the saved baseline", async () => {
    const t = setup();
    t.type("ab");
    t.type("a");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.saved).toEqual([]);
  });

  it("waits while the tab is hidden and saves when it becomes visible", async () => {
    const t = setup();
    t.setVisible(false);
    t.type("ab");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.saved).toEqual([]);
    t.setVisible(true);
    t.scheduler.notifyVisibility();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.saved).toEqual(["ab"]);
  });

  it("reports a failure and retries after the interval", async () => {
    const t = setup();
    t.setFail(true);
    t.type("ab");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.statuses.at(-1)).toEqual({ kind: "error" });
    t.setFail(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.saved).toEqual(["ab"]);
  });

  it("an explicit save marks the text as saved; dispose cancels the timer", async () => {
    const t = setup();
    t.type("ab");
    t.scheduler.markSaved("ab");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.saved).toEqual([]);
    t.type("abc");
    t.scheduler.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.saved).toEqual([]);
  });

  it("labels: seconds, relative, failure, pending", () => {
    const now = 1_000_000;
    expect(autosaveLabel({ kind: "saved", at: now - 12_000 }, false, now)).toContain("12");
    expect(autosaveLabel({ kind: "saved", at: now - 1_000 }, false, now)).not.toContain("1 ");
    expect(autosaveLabel({ kind: "error" }, true, now)).toContain("محفوظ على جهازك");
    expect(autosaveLabel({ kind: "saving" }, true, now)).toContain("جارٍ الحفظ");
    expect(autosaveLabel({ kind: "idle" }, false, now)).toBe("");
    expect(autosaveLabel({ kind: "idle" }, true, now)).not.toBe("");
  });
});

const detail = (overrides: Partial<ContentItemDetail> = {}): ContentItemDetail =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-01-01T00:00:00.000Z",
    payload: { title: "T", excerpt: "", definition: "", bodyMd: "server" },
    meta: emptyDraft().meta,
    autosave: null,
    ...overrides,
  }) as ContentItemDetail;

describe("local mirror and restore offer", () => {
  afterEach(() => {
    window.localStorage.clear();
  });
  const mirror = (savedAt: number, bodyMd: string) => ({
    savedAt,
    baseRevisionId: null,
    payload: { title: "T", excerpt: "", definition: "", bodyMd },
    meta: emptyDraft().meta,
  });

  it("round-trips through localStorage and survives broken storage", () => {
    writeMirror("k", mirror(5, "x"));
    expect(readMirror("k")?.payload.bodyMd).toBe("x");
    clearMirror("k");
    expect(readMirror("k")).toBeNull();
    window.localStorage.setItem("wasfa.content-editor.v1:bad", "{not json");
    expect(readMirror("bad")).toBeNull();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeMirror("k", mirror(5, "x"))).not.toThrow();
    spy.mockRestore();
  });

  it("offers a local copy only when newer than the server and different from it", () => {
    const newer = Date.parse("2026-02-01T00:00:00Z");
    expect(pickRestoreOffer(detail(), mirror(newer, "mine"))?.source).toBe("local");
    expect(pickRestoreOffer(detail(), mirror(newer, "server"))).toBeNull();
    expect(
      pickRestoreOffer(detail(), mirror(Date.parse("2025-01-01T00:00:00Z"), "old")),
    ).toBeNull();
    expect(pickRestoreOffer(detail(), null)).toBeNull();
  });

  it("prefers the newest of the server autosave and the local mirror", () => {
    const autosave = {
      payload: { title: "T", excerpt: "", definition: "", bodyMd: "auto" },
      savedAt: "2026-02-02T00:00:00.000Z",
      baseRevisionId: "22222222-2222-4222-8222-222222222222",
    };
    const d = detail({ autosave });
    expect(pickRestoreOffer(d, mirror(Date.parse("2026-02-01T00:00:00Z"), "local"))?.source).toBe(
      "server",
    );
    expect(pickRestoreOffer(d, mirror(Date.parse("2026-02-03T00:00:00Z"), "local"))?.source).toBe(
      "local",
    );
  });
});

describe("draft patches", () => {
  it("sends only what changed and nothing for an empty slug", () => {
    const a = emptyDraft();
    const b = emptyDraft();
    b.payload.title = "New";
    b.meta.seo.focusKeyword = "kw";
    b.meta.flags.showToc = true;
    expect(payloadPatch(a.payload, b.payload)).toEqual({ title: "New" });
    expect(metaPatch(a.meta, b.meta)).toEqual({
      seo: { focusKeyword: "kw" },
      flags: { showToc: true },
    });
    expect(buildUpdateBody(a, a, 3)).toBeNull();
    expect(buildUpdateBody(a, b, 3, " note ")).toMatchObject({ lockVersion: 3, note: "note" });
    b.meta.slug = "";
    expect(metaPatch(a.meta, b.meta)).not.toHaveProperty("slug");
  });

  it("create body drops an empty slug", () => {
    const d = emptyDraft();
    d.payload.title = "T";
    expect(buildCreateBody({ type: "article", locale: "ar", draft: d }).meta).not.toHaveProperty(
      "slug",
    );
    d.meta.slug = "my-slug";
    expect(buildCreateBody({ type: "article", locale: "ar", draft: d }).meta).toHaveProperty(
      "slug",
      "my-slug",
    );
  });
});

describe("conflict handling", () => {
  const conflictError = (details?: Record<string, unknown>) =>
    new ApiRequestError("CONTENT_CONFLICT", "x", undefined, 409, details);

  it("reads the lock version and revision id from the error details", () => {
    expect(
      conflictFromError(
        conflictError({
          currentLockVersion: 7,
          currentRevisionId: "11111111-1111-4111-8111-111111111111",
        }),
      ),
    ).toEqual({ currentLockVersion: 7, currentRevisionId: "11111111-1111-4111-8111-111111111111" });
    expect(conflictFromError(conflictError())).toEqual({
      currentLockVersion: -1,
      currentRevisionId: null,
    });
    expect(conflictFromError(new ApiRequestError("NOT_FOUND", "x"))).toBeNull();
    expect(conflictFromError(new Error("x"))).toBeNull();
  });

  it("each choice maps to the right effect", () => {
    const info = { currentLockVersion: 7, currentRevisionId: null };
    expect(resolveConflict("overwrite", info).retryWithLockVersion).toBe(7);
    expect(resolveConflict("overwrite", { ...info, currentLockVersion: -1 })).toMatchObject({
      retryWithLockVersion: null,
      replaceDraft: true,
    });
    expect(resolveConflict("reload", info)).toMatchObject({
      replaceDraft: true,
      keepMirror: false,
    });
    expect(resolveConflict("copy", info)).toMatchObject({ replaceDraft: false, keepMirror: true });
  });
});

describe("primary action derivation", () => {
  const ctx = {
    isNew: false,
    dirty: false,
    status: "draft" as const,
    live: false,
    allowedActions: [] as never[],
    canWrite: true,
  };

  it("new and dirty items save first", () => {
    expect(derivePrimaryAction({ ...ctx, isNew: true }).kind).toBe("save");
    expect(derivePrimaryAction({ ...ctx, dirty: true, allowedActions: ["publish"] })).toMatchObject(
      {
        kind: "save",
        disabled: false,
      },
    );
  });

  it("clean items offer the next workflow step", () => {
    expect(derivePrimaryAction({ ...ctx, allowedActions: ["submit"] })).toMatchObject({
      action: "submit",
    });
    expect(derivePrimaryAction({ ...ctx, allowedActions: ["publish"] })).toMatchObject({
      action: "publish",
      label: "admin.editor.action.publish",
    });
    expect(derivePrimaryAction({ ...ctx, live: true, allowedActions: ["publish"] })).toMatchObject({
      label: "admin.editor.action.update",
    });
    expect(
      derivePrimaryAction({
        ...ctx,
        status: "in_review",
        allowedActions: ["approve", "request_changes"],
      }),
    ).toMatchObject({ action: "approve" });
    expect(
      derivePrimaryAction({ ...ctx, status: "approved", allowedActions: ["publish", "schedule"] }),
    ).toMatchObject({
      action: "publish",
    });
    expect(derivePrimaryAction(ctx)).toMatchObject({ kind: "save", disabled: true });
  });

  it("a reviewer without write access never gets Save", () => {
    expect(
      derivePrimaryAction({
        ...ctx,
        dirty: true,
        canWrite: false,
        status: "in_review",
        allowedActions: ["approve"],
      }),
    ).toMatchObject({ action: "approve" });
  });

  it("overflow lists only allowed secondary actions; review needs permission AND action", () => {
    expect(overflowActions(["publish", "archive", "schedule", "approve"])).toEqual([
      "schedule",
      "archive",
    ]);
    expect(canReviewNow(["content.review"], ["approve", "request_changes"])).toEqual({
      approve: true,
      requestChanges: true,
    });
    expect(canReviewNow(["content.write"], ["approve"])).toEqual({
      approve: false,
      requestChanges: false,
    });
    expect(canReviewNow(["content.review"], [])).toEqual({ approve: false, requestChanges: false });
  });
});

describe("error mapping", () => {
  it("has a message key for every CONTENT_* error code", () => {
    const codes = ERROR_CODES.filter((code) => code.startsWith("CONTENT_"));
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(CONTENT_ERROR_KEYS).toHaveProperty(code);
    for (const code of codes) {
      expect(describeContentError(new ApiRequestError(code, "server text")).message).not.toBe(
        "server text",
      );
    }
  });

  it("falls back to the server message for other codes and extracts gate ids", () => {
    expect(describeContentError(new ApiRequestError("RATE_LIMITED", "slow down")).message).toBe(
      "slow down",
    );
    const error = new ApiRequestError("CONTENT_GATES_BLOCK", "x", undefined, 422, {
      gates: ["min_words", "bogus", "image_alt"],
    });
    expect(gateIdsFromError(error)).toEqual(["min_words", "image_alt"]);
    expect(describeContentError(error).gateIds).toEqual(["min_words", "image_alt"]);
  });
});

describe("useKeyboardInset", () => {
  type Listener = () => void;
  function fakeViewport(height: number, offsetTop = 0) {
    const listeners = new Map<string, Set<Listener>>();
    return {
      height,
      offsetTop,
      addEventListener: (type: string, fn: Listener) => {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
      },
      removeEventListener: (type: string, fn: Listener) => {
        listeners.get(type)?.delete(fn);
      },
      emit: (type: string) => {
        listeners.get(type)?.forEach((fn) => fn());
      },
      count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    };
  }

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
  });

  it("computes the covered strip", () => {
    expect(computeKeyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300);
    expect(computeKeyboardInset(800, { height: 500, offsetTop: 100 })).toBe(200);
    expect(computeKeyboardInset(800, { height: 900, offsetTop: 0 })).toBe(0);
  });

  it("tracks resize only while active and cleans up", () => {
    const vv = fakeViewport(800);
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const { result, rerender } = renderHook(({ active }) => useKeyboardInset(active), {
      initialProps: { active: false },
    });
    expect(result.current).toEqual({ inset: 0, supported: true });
    expect(vv.count()).toBe(0);
    rerender({ active: true });
    expect(vv.count()).toBe(2);
    act(() => {
      vv.height = 480;
      vv.emit("resize");
    });
    expect(result.current.inset).toBe(320);
    rerender({ active: false });
    expect(vv.count()).toBe(0);
    expect(result.current.inset).toBe(0);
  });

  it("reports unsupported browsers", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    const { result } = renderHook(() => useKeyboardInset(true));
    expect(result.current).toEqual({ inset: 0, supported: false });
  });
});
