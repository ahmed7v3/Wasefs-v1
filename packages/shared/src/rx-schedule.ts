/*
 * A daily dosing schedule read from what the doctor wrote on a prescription line (frequency, dose,
 * duration, notes): how many times a day, every N hours, with respect to meals, at bedtime, as needed,
 * for how many days; plus SUGGESTED clock times for the doses.
 *
 * Deterministic code, never a model. Medical safety rules:
 *  - nothing is derived that the text does not say: no frequency -> no slots (the UI then says "follow
 *    your doctor's instructions");
 *  - the clock times are a fixed, conservative convention (table below) and are always presented to
 *    the user as "suggested", never as the doctor's order;
 *  - the function never throws: whatever it cannot read is left out.
 *
 * Suggested clock times (24h, local time of the patient):
 *   every 6 h  -> 06:00 12:00 18:00 00:00      every 8 h -> 08:00 16:00 00:00
 *   every 12 h -> 08:00 20:00                  every 24 h -> 08:00
 *   any other interval -> no slots
 *   1 a day -> 08:00 (21:00 when the text says evening/night; 22:00 when it says bedtime)
 *   2 a day -> 08:00 20:00        3 a day -> 08:00 14:00 20:00        4 a day -> 08:00 12:00 16:00 20:00
 *   5-12 a day -> evenly every floor(12 / (N - 1)) hours from 08:00
 *   "at bedtime" with other doses replaces the LAST dose with 22:00; alone it is the only dose
 *   "as needed" -> no slots     unknown / alternate days -> no slots
 */
import { normalizeArabic } from "./normalize.js";
import { normalizeDuration, normalizeFrequency } from "./rx-normalize.js";

export const DOSE_SLOT_KEYS = [
  "morning",
  "noon",
  "afternoon",
  "evening",
  "night",
  "bedtime",
] as const;
export type DoseSlotKey = (typeof DOSE_SLOT_KEYS)[number];

export type DoseMeal = "before" | "after" | "with" | "empty_stomach";

export interface DoseSlot {
  key: DoseSlotKey;
  /** "HH:MM", 24 hours. */
  time: string;
}

export interface DoseSchedule {
  timesPerDay: number | null;
  everyHours: number | null;
  meal: DoseMeal | null;
  bedtime: boolean;
  asNeeded: boolean;
  slots: DoseSlot[];
  days: number | null;
}

export interface ScheduleInput {
  frequency?: string | null;
  dose?: string | null;
  duration?: string | null;
  notes?: string | null;
  route?: string | null;
}

const EMPTY: DoseSchedule = {
  timesPerDay: null,
  everyHours: null,
  meal: null,
  bedtime: false,
  asNeeded: false,
  slots: [],
  days: null,
};

/** Not inside a word (Arabic letters have no `\b`). */
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
const re = (source: string): RegExp =>
  new RegExp(`${START}(?:${normalizeArabic(source)})${END}`, "iu");

/** One spelling: folded Arabic, lower case, `x` for every multiplication sign, abbreviations without dots. */
function prepare(text: string | null | undefined): string {
  if (text === null || text === undefined) return "";
  return normalizeArabic(text)
    .toLowerCase()
    .replace(/[×✕✖*]/g, "x")
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, "")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_COUNTS: Readonly<Record<string, number>> = {
  one: 1,
  once: 1,
  two: 2,
  twice: 2,
  three: 3,
  thrice: 3,
  four: 4,
  five: 5,
  six: 6,
  واحده: 1,
  مره: 1,
  مرتين: 2,
  اثنين: 2,
  اتنين: 2,
  ثلاث: 3,
  تلات: 3,
  اربع: 4,
  خمس: 5,
  ست: 6,
};
const WORD_ALTERNATIVES = Object.keys(WORD_COUNTS).join("|");
const ABBREVIATIONS: Readonly<Record<string, number>> = {
  od: 1,
  qd: 1,
  bid: 2,
  bd: 2,
  tid: 3,
  tds: 3,
  qid: 4,
  qds: 4,
};

const MAX_PER_DAY = 12;
const validCount = (n: number): number | null =>
  Number.isInteger(n) && n >= 1 && n <= MAX_PER_DAY ? n : null;

interface Times {
  timesPerDay: number | null;
  everyHours: number | null;
  /** The text says every other day / every N days: no daily schedule can be drawn. */
  skip: boolean;
}

/** How often, from one prepared text; `null` fields = not stated. */
function readTimes(s: string): Times {
  const none: Times = { timesPerDay: null, everyHours: null, skip: false };
  if (re("qod|every\\s*other\\s*day|يوما بعد يوم|يوم بعد يوم|كل يومين").test(s)) {
    return { ...none, skip: true };
  }
  const hours =
    /(?<![\p{L}\p{N}])(?:q\s*(\d+)\s*h(?:rs?|ours?)?|every\s*(\d+)\s*(?:h|hrs?|hours?)|كل\s*(\d+)\s*ساع(?:ات|ه))(?![\p{L}\p{N}])/iu.exec(
      s,
    );
  if (hours !== null) {
    const n = Number(hours[1] ?? hours[2] ?? hours[3]);
    return Number.isInteger(n) && n >= 1 && n <= 48 ? { ...none, everyHours: n } : none;
  }
  if (re("كل ساعتين|every\\s*(?:2|two)\\s*hours").test(s)) return { ...none, everyHours: 2 };
  if (re("كل ساعه|every\\s*hour|hourly").test(s)) return { ...none, everyHours: 1 };

  const product = /(?<![\p{L}\p{N}])(\d+)\s*x\s*(\d+)(?![\p{L}\p{N}])/u.exec(s);
  if (product !== null) {
    return { ...none, timesPerDay: validCount(Math.max(Number(product[1]), Number(product[2]))) };
  }
  const counted = new RegExp(
    `${START}(\\d+|${WORD_ALTERNATIVES})\\s*(?:times?|مرات|مره|مرتين)${END}`,
    "iu",
  ).exec(s);
  if (counted !== null) {
    const raw = counted[1] ?? "";
    return { ...none, timesPerDay: validCount(WORD_COUNTS[raw] ?? Number(raw)) };
  }
  const word = new RegExp(`${START}(once|twice|thrice|مرتين|مره)${END}`, "iu").exec(s);
  if (word !== null) return { ...none, timesPerDay: WORD_COUNTS[word[1] ?? ""] ?? null };
  const abbreviation = re("od|qd|bid|bd|tid|tds|qid|qds").exec(s);
  if (abbreviation !== null)
    return { ...none, timesPerDay: ABBREVIATIONS[abbreviation[0]] ?? null };
  if (re("daily|every\\s*day|كل يوم|يوميا|مره يوميا").test(s)) return { ...none, timesPerDay: 1 };
  return none;
}

const MEAL_RULES: readonly (readonly [DoseMeal, RegExp])[] = [
  ["empty_stomach", re("empty\\s*stomach|fasting|على الريق|على معده فارغه")],
  ["before", re("ac|before\\s*(?:meals?|food|eating)|قبل (?:ال)?(?:اكل|طعام|وجبات|وجبه)")],
  ["after", re("pc|after\\s*(?:meals?|food|eating)|بعد (?:ال)?(?:اكل|طعام|وجبات|وجبه)")],
  ["with", re("with\\s*(?:meals?|food)|مع (?:ال)?(?:اكل|طعام|وجبات|وجبه)")],
];
const NEGATION = re("لا|ليس|بدون|دون|not|don't|dont|avoid|without|never");
const BEDTIME = re(
  "q?hs|at\\s*bed\\s*time|bed\\s*time|before\\s*(?:sleep|bed)|قبل النوم|عند النوم",
);
const AS_NEEDED = re(
  "prn|sos|as\\s*needed|when\\s*needed|if\\s*needed|عند اللزوم|عند الحاجه|اذا لزم(?: الامر)?|لو لزم",
);

/** Clock times for N doses a day (see the table at the top). */
function spread(count: number): DoseSlot[] {
  const hours: Record<number, number[]> = {
    1: [8],
    2: [8, 20],
    3: [8, 14, 20],
    4: [8, 12, 16, 20],
  };
  const chosen =
    hours[count] ?? Array.from({ length: count }, (_, i) => 8 + i * Math.floor(12 / (count - 1)));
  return chosen.map((hour) => ({ key: keyOfHour(hour), time: clock(hour) }));
}

function keyOfHour(hour: number): DoseSlotKey {
  if (hour >= 22) return "night";
  if (hour >= 17) return "evening";
  if (hour >= 14) return "afternoon";
  if (hour >= 11) return "noon";
  if (hour >= 5) return "morning";
  return "night";
}

const clock = (hour: number): string => `${String(hour % 24).padStart(2, "0")}:00`;

function everyHoursSlots(hours: number): DoseSlot[] {
  if (hours === 6) {
    return [
      { key: "morning", time: "06:00" },
      { key: "noon", time: "12:00" },
      { key: "evening", time: "18:00" },
      { key: "night", time: "00:00" },
    ];
  }
  if (hours === 8) {
    return [
      { key: "morning", time: "08:00" },
      { key: "afternoon", time: "16:00" },
      { key: "night", time: "00:00" },
    ];
  }
  if (hours === 12) return spread(2);
  if (hours === 24) return spread(1);
  return [];
}

/** Day-period words that fix the slots by themselves ("صباحا ومساء"), in day order. */
const PERIODS: readonly (readonly [DoseSlotKey, number, RegExp])[] = [
  ["morning", 8, re("و?(?:صباحا|صباح|الصبح)|morning")],
  ["noon", 13, re("و?(?:ظهرا|ظهر)|noon|midday")],
  ["afternoon", 16, re("و?(?:عصرا|عصر)|afternoon")],
  ["evening", 20, re("و?(?:مساء|مساءا)|evening")],
  ["night", 21, re("و?ليلا|بالليل|night")],
];

function readPeriods(s: string): DoseSlot[] {
  const found = PERIODS.filter(([, , pattern]) => pattern.test(s));
  // A lone evening/night dose is the 21:00 one of the table.
  const lone = found.length === 1;
  return found.map(([key, hour]) => ({
    key,
    time: clock(lone && (key === "evening" || key === "night") ? 21 : hour),
  }));
}

function mealOf(texts: readonly string[], guarded: readonly boolean[]): DoseMeal | null {
  for (const [index, s] of texts.entries()) {
    if (s === "" || (guarded[index] === true && NEGATION.test(s))) continue;
    for (const [meal, pattern] of MEAL_RULES) if (pattern.test(s)) return meal;
  }
  return null;
}

const DAYS_PER_UNIT = { day: 1, week: 7, month: 30 } as const;

/** Days from the standard duration phrase ("5 أيام", "أسبوعان", "شهر"); null for "continuous" or unknown text. */
function readDays(duration: string | null | undefined): number | null {
  if (duration === null || duration === undefined || duration.trim() === "") return null;
  const s = prepare(normalizeDuration(duration));
  const unit = (word: string): keyof typeof DAYS_PER_UNIT | null =>
    /^(?:يوم|يوما|يومان|يومين|ايام|day|days)$/.test(word)
      ? "day"
      : /^(?:اسبوع|اسبوعا|اسبوعان|اسبوعين|اسابيع|week|weeks)$/.test(word)
        ? "week"
        : /^(?:شهر|شهرا|شهران|شهرين|اشهر|شهور|month|months)$/.test(word)
          ? "month"
          : null;
  const counted = /^(?:for\s+|x\s*|لمده\s+|مده\s+|خلال\s+)?(\d+)\s*([^\s\d]+)$/u.exec(s);
  if (counted !== null) {
    const u = unit(counted[2] ?? "");
    const n = Number(counted[1]);
    return u === null || !(n >= 1) ? null : Math.round(n * DAYS_PER_UNIT[u]);
  }
  const single = unit(s.replace(/^(?:for\s+|لمده\s+|مده\s+|خلال\s+|(?:a|an|one)\s+)/u, ""));
  if (single === null) return null;
  const dual = /ان$|ين$/.test(s.split(" ").at(-1) ?? "") && single !== "day" ? 2 : 1;
  if (single === "day") return /^(?:يومان|يومين)$/.test(s) ? 2 : 1;
  return dual * DAYS_PER_UNIT[single];
}

/** The schedule of one prescription line. Never throws; unreadable parts are simply absent. */
export function scheduleOf(item: ScheduleInput): DoseSchedule {
  try {
    return build(item);
  } catch {
    return { ...EMPTY, slots: [] };
  }
}

function build(item: ScheduleInput): DoseSchedule {
  const frequency = item.frequency ?? null;
  const normalized = frequency === null ? null : normalizeFrequency(frequency);
  // The standard phrase first, then the text as written: either may carry what the other lacks.
  const freqTexts = [prepare(normalized), prepare(frequency)].filter((s) => s !== "");
  const dose = prepare(item.dose);
  const notes = prepare(item.notes);
  const all = [...freqTexts, dose, notes];
  // Free text (dose, notes) may say "do not take before meals": no meal is read from a negated sentence.
  const guarded = all.map((_, index) => index >= freqTexts.length);

  let times: Times = { timesPerDay: null, everyHours: null, skip: false };
  // Only the frequency field is read for "how often": a dose such as "2x5 ml" must not become 5 a day.
  for (const s of freqTexts) {
    times = readTimes(s);
    if (times.skip || times.timesPerDay !== null || times.everyHours !== null) break;
  }

  const anyOf = (pattern: RegExp, sources: readonly string[]): boolean =>
    sources.some((s) => pattern.test(s));
  const bedtime =
    anyOf(BEDTIME, freqTexts) || (anyOf(BEDTIME, [dose, notes]) && !anyOf(NEGATION, [notes]));
  const asNeeded = anyOf(AS_NEEDED, freqTexts) || anyOf(AS_NEEDED, [dose, notes]);
  const meal = mealOf(all, guarded);
  const days = readDays(item.duration);

  let { timesPerDay } = times;
  const { everyHours } = times;
  const periods = readPeriods(freqTexts.join(" "));
  if (timesPerDay === null && everyHours === null && !times.skip && periods.length > 0) {
    timesPerDay = periods.length;
  }
  if (everyHours !== null && 24 % everyHours === 0) timesPerDay = 24 / everyHours;

  const base: DoseSchedule = { ...EMPTY, timesPerDay, everyHours, meal, bedtime, asNeeded, days };
  if (times.skip || asNeeded) return { ...base, slots: [] };

  let slots: DoseSlot[] = [];
  if (everyHours !== null) {
    slots = everyHoursSlots(everyHours);
  } else if (timesPerDay !== null && periods.length === timesPerDay) {
    slots = periods;
  } else if (timesPerDay !== null) {
    slots = spread(timesPerDay);
    if (timesPerDay === 1 && periods.length === 1) slots = periods;
  } else if (bedtime) {
    return { ...base, timesPerDay: 1, slots: [{ key: "bedtime", time: "22:00" }] };
  }
  if (bedtime && slots.length > 0 && everyHours === null) {
    slots = [...slots.slice(0, -1), { key: "bedtime", time: "22:00" }];
  }
  return { ...base, slots };
}

/** "08:00" -> "8 ص" / "8 AM", "14:30" -> "2:30 م" / "2:30 PM". Minutes only when not zero. */
export function formatClock(time: string, suffix: { am: string; pm: string }): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (match === null) return time;
  const hour = Number(match[1]) % 24;
  const minute = match[2] ?? "00";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(twelve)}${minute === "00" ? "" : `:${minute}`} ${hour < 12 ? suffix.am : suffix.pm}`;
}

/** Order of a clock time within a day that starts at 05:00, so that 00:00 comes after 22:00. */
export function dayOrder(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (match === null) return Number.MAX_SAFE_INTEGER;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 5 * 60 ? minutes + 24 * 60 : minutes;
}
