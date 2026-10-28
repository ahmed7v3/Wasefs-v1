import { describe, expect, it } from "vitest";

import { dayOrder, formatClock, scheduleOf } from "../src/rx-schedule.js";

const times = (frequency: string | null, extra: Record<string, string | null> = {}): string[] =>
  scheduleOf({ frequency, ...extra }).slots.map((slot) => slot.time);

describe("scheduleOf: how often", () => {
  const perDay: [string, number][] = [
    ["1x3", 3],
    ["1×3", 3],
    ["3x1", 3],
    ["١×٣", 3],
    ["2x2", 2],
    ["3 مرات يوميًا", 3],
    ["ثلاث مرات يوميا", 3],
    ["مرتين يوميًا", 2],
    ["مرتين", 2],
    ["مرة يوميًا", 1],
    ["مرة واحدة يوميا", 1],
    ["يوميا", 1],
    ["daily", 1],
    ["once daily", 1],
    ["twice a day", 2],
    ["3 times a day", 3],
    ["bid", 2],
    ["B.I.D.", 2],
    ["tid", 3],
    ["t.i.d", 3],
    ["qid", 4],
    ["od", 1],
    ["qd", 1],
  ];
  it.each(perDay)("%s is %i a day", (text, count) => {
    expect(scheduleOf({ frequency: text }).timesPerDay).toBe(count);
  });

  it.each([
    ["كل 8 ساعات", 8],
    ["كل ٦ ساعات", 6],
    ["كل 12 ساعة", 12],
    ["كل ساعتين", 2],
    ["q8h", 8],
    ["Q6H", 6],
    ["every 12 hours", 12],
  ])("%s is every %i hours", (text, hours) => {
    expect(scheduleOf({ frequency: text }).everyHours).toBe(hours);
  });

  it("is empty for missing, empty or unreadable frequency and never throws", () => {
    for (const frequency of [
      null,
      undefined,
      "",
      "   ",
      "حسب الحاجة الطبيب",
      "???",
      "x".repeat(5000),
    ]) {
      const schedule = scheduleOf({ frequency });
      expect(schedule.slots).toEqual([]);
      expect(schedule.timesPerDay).toBeNull();
    }
    expect(scheduleOf({})).toMatchObject({ slots: [], days: null, meal: null, asNeeded: false });
  });

  it("does not draw a daily schedule for alternate days", () => {
    for (const text of ["qod", "يومًا بعد يوم", "every other day"]) {
      expect(scheduleOf({ frequency: text }).slots).toEqual([]);
    }
  });

  it("ignores absurd counts", () => {
    expect(scheduleOf({ frequency: "1x40" }).slots).toEqual([]);
    expect(scheduleOf({ frequency: "كل 100 ساعة" }).slots).toEqual([]);
  });
});

describe("scheduleOf: suggested clock times", () => {
  it.each([
    ["كل 6 ساعات", ["06:00", "12:00", "18:00", "00:00"]],
    ["q8h", ["08:00", "16:00", "00:00"]],
    ["كل 8 ساعات", ["08:00", "16:00", "00:00"]],
    ["كل 12 ساعة", ["08:00", "20:00"]],
    ["every 24 hours", ["08:00"]],
    ["كل 5 ساعات", []],
    ["كل 3 ساعات", []],
    ["od", ["08:00"]],
    ["bid", ["08:00", "20:00"]],
    ["tid", ["08:00", "14:00", "20:00"]],
    ["qid", ["08:00", "12:00", "16:00", "20:00"]],
    ["1x5", ["08:00", "11:00", "14:00", "17:00", "20:00"]],
  ])("%s -> %j", (text, expected) => {
    expect(times(text)).toEqual(expected);
  });

  it("names the slots", () => {
    expect(scheduleOf({ frequency: "tid" }).slots.map((s) => s.key)).toEqual([
      "morning",
      "afternoon",
      "evening",
    ]);
  });

  it("puts a lone evening or night dose at 21:00", () => {
    expect(times("مرة يوميا مساءً")).toEqual(["21:00"]);
    expect(times("once daily at night")).toEqual(["21:00"]);
  });

  it("uses the day periods the doctor wrote", () => {
    expect(times("صباحًا ومساءً")).toEqual(["08:00", "20:00"]);
    expect(scheduleOf({ frequency: "صباحا" })).toMatchObject({ timesPerDay: 1 });
    expect(times("صباحا")).toEqual(["08:00"]);
  });

  it("bedtime alone is one dose at 22:00, and replaces the last of several", () => {
    expect(scheduleOf({ frequency: "قبل النوم" })).toMatchObject({
      bedtime: true,
      timesPerDay: 1,
      slots: [{ key: "bedtime", time: "22:00" }],
    });
    expect(times("hs")).toEqual(["22:00"]);
    expect(times("مرة يوميا قبل النوم")).toEqual(["22:00"]);
    expect(times("مرتين يوميا قبل النوم")).toEqual(["08:00", "22:00"]);
  });

  it("gives no slots for as-needed use", () => {
    const schedule = scheduleOf({ frequency: "عند اللزوم" });
    expect(schedule).toMatchObject({ asNeeded: true, slots: [] });
    expect(scheduleOf({ frequency: "prn" }).asNeeded).toBe(true);
    expect(scheduleOf({ frequency: "tid prn" })).toMatchObject({ asNeeded: true, slots: [] });
    expect(scheduleOf({ frequency: null, notes: "عند الحاجة فقط" }).asNeeded).toBe(true);
  });
});

describe("scheduleOf: meals", () => {
  it.each([
    ["3 مرات يوميا قبل الأكل", "before"],
    ["tid ac", "before"],
    ["before meals", "before"],
    ["بعد الأكل", "after"],
    ["bid pc", "after"],
    ["after food", "after"],
    ["مع الأكل", "with"],
    ["with meals", "with"],
    ["على الريق", "empty_stomach"],
    ["empty stomach", "empty_stomach"],
  ])("%s -> %s", (text, meal) => {
    expect(scheduleOf({ frequency: text }).meal).toBe(meal);
  });

  it("reads the meal from the doctor's notes, but not from a negated sentence", () => {
    expect(scheduleOf({ frequency: "bid", notes: "يؤخذ بعد الأكل مباشرة" }).meal).toBe("after");
    expect(scheduleOf({ frequency: "bid", notes: "لا يؤخذ قبل الأكل" }).meal).toBeNull();
    expect(scheduleOf({ frequency: "bid", notes: "do not take after food" }).meal).toBeNull();
  });

  it("keeps the clock times when a meal is stated", () => {
    expect(times("tid pc")).toEqual(["08:00", "14:00", "20:00"]);
  });
});

describe("scheduleOf: duration", () => {
  it.each([
    ["5 أيام", 5],
    ["لمدة 5 أيام", 5],
    ["x 7 days", 7],
    ["for 10 days", 10],
    ["12 يوم", 12],
    ["يومين", 2],
    ["أسبوع", 7],
    ["1 week", 7],
    ["اسبوعين", 14],
    ["3 أسابيع", 21],
    ["2 weeks", 14],
    ["شهر", 30],
    ["شهرين", 60],
    ["3 months", 90],
  ])("%s is %i days", (text, days) => {
    expect(scheduleOf({ frequency: "bid", duration: text }).days).toBe(days);
  });

  it.each(["مستمر", "حتى انتهاء العلبة", "", null, "10"])("%s has no day count", (text) => {
    expect(scheduleOf({ frequency: "bid", duration: text }).days).toBeNull();
  });
});

describe("clock helpers", () => {
  const ar = { am: "ص", pm: "م" };
  it("formats 12-hour clock times", () => {
    expect(formatClock("08:00", ar)).toBe("8 ص");
    expect(formatClock("14:00", ar)).toBe("2 م");
    expect(formatClock("00:00", ar)).toBe("12 ص");
    expect(formatClock("12:00", ar)).toBe("12 م");
    expect(formatClock("20:30", { am: "AM", pm: "PM" })).toBe("8:30 PM");
    expect(formatClock("bad", ar)).toBe("bad");
  });
  it("orders midnight after the evening", () => {
    const sorted = ["00:00", "06:00", "22:00"].sort((a, b) => dayOrder(a) - dayOrder(b));
    expect(sorted).toEqual(["06:00", "22:00", "00:00"]);
  });
});
