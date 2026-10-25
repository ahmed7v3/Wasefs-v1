"use client";

import { t } from "@wasfa/shared/i18n";
import { contentListResponseSchema } from "@wasfa/shared/schemas/content";
import { Button, Card, Skeleton, cn } from "@wasfa/ui";
import { CalendarCheck, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api-client";
import {
  agendaDays,
  buildCalendarEntries,
  entriesByDay,
  publishedQuery,
  scheduledQuery,
  type CalendarEntry,
} from "../../lib/content-calendar";
import {
  dayNumber,
  formatDayLabel,
  formatMonthLabel,
  formatWeekdayShort,
  isMonthKey,
  monthGrid,
  shiftMonth,
  timeKey,
  todayKey,
  weekStartFor,
} from "../../lib/content-time";
import { buildQuery } from "../../lib/use-admin-data";
import { useContentTimeZone } from "../../lib/use-content-time-zone";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import type { ContentItemSummary } from "@wasfa/shared/schemas/content";

const PAGE_SIZE = 100;
/** A month rarely holds more than a few hundred items; the cap bounds a runaway filter, not normal use. */
const MAX_PAGES = 10;

async function fetchPages(
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<ContentItemSummary[]> {
  const items: ContentItemSummary[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = buildQuery({
      ...params,
      limit: String(PAGE_SIZE),
      ...(cursor ? { cursor } : {}),
    });
    const answer: { items: ContentItemSummary[]; nextCursor: string | null } = await api(
      `/admin/content/items?${query}`,
      { schema: contentListResponseSchema, signal },
    );
    items.push(...answer.items);
    if (answer.nextCursor === null) break;
    cursor = answer.nextCursor;
  }
  return items;
}

type CalendarData =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; scheduled: ContentItemSummary[]; published: ContentItemSummary[] };

const KIND_STYLE: Record<CalendarEntry["kind"], string> = {
  scheduled: "bg-accent-soft text-primary",
  published: "bg-success-soft text-success",
};

function EntryChip({ entry, timeZone }: { entry: CalendarEntry; timeZone: string }) {
  const Icon = entry.kind === "scheduled" ? Clock : CalendarCheck;
  return (
    <Link
      href={`/admin/content/${entry.item.id}`}
      className={cn(
        "flex min-h-11 items-start gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:shadow-focus",
        KIND_STYLE[entry.kind],
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="sr-only">{t(`admin.content.calendar.kind.${entry.kind}`)}</span>
      <span className="min-w-0 break-words">
        <bdi dir="ltr" className="me-1 tabular-nums">
          {timeKey(entry.at, timeZone)}
        </bdi>
        {entry.item.title}
      </span>
    </Link>
  );
}

export function ContentCalendarView() {
  const url = useUrlParams();
  const timeZone = useContentTimeZone();
  const weekStart = weekStartFor("ar");
  const today = todayKey(timeZone);
  const requested = url.get("month");
  const month = isMonthKey(requested) ? requested : today.slice(0, 7);

  const [data, setData] = useState<CalendarData>({ status: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData({ status: "loading" });
    Promise.all([
      fetchPages({ status: "scheduled", ...scheduledQuery(month, weekStart) }, controller.signal),
      fetchPages({ live: "true", ...publishedQuery(month, weekStart) }, controller.signal),
    ]).then(
      ([scheduled, published]) => {
        setData({ status: "ready", scheduled, published });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setData({ status: "error", error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [month, weekStart, tick]);

  const entries = useMemo(
    () =>
      data.status === "ready"
        ? buildCalendarEntries(data.scheduled, data.published, timeZone, month, weekStart)
        : [],
    [data, timeZone, month, weekStart],
  );
  const byDay = useMemo(() => entriesByDay(entries), [entries]);
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const agenda = useMemo(() => agendaDays(entries, month), [entries, month]);

  const goTo = (target: string) => {
    url.update({ month: target === today.slice(0, 7) ? null : target });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold text-text" aria-live="polite">
          {formatMonthLabel(month)}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            aria-label={t("admin.content.calendar.prev")}
            onClick={() => {
              goTo(shiftMonth(month, -1));
            }}
          >
            <ChevronRight aria-hidden className="size-5 rtl:rotate-0 ltr:rotate-180" />
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              goTo(today.slice(0, 7));
            }}
          >
            {t("admin.content.calendar.today")}
          </Button>
          <Button
            variant="secondary"
            aria-label={t("admin.content.calendar.next")}
            onClick={() => {
              goTo(shiftMonth(month, 1));
            }}
          >
            <ChevronLeft aria-hidden className="size-5 rtl:rotate-0 ltr:rotate-180" />
          </Button>
        </div>
      </div>

      <p className="text-sm text-text-muted">
        {t("admin.content.calendar.zone", { zone: timeZone })}
      </p>

      {data.status === "error" ? (
        <ErrorNotice
          error={data.error}
          onRetry={() => {
            setTick((current) => current + 1);
          }}
        />
      ) : data.status === "loading" ? (
        <Card elevation="flat" aria-busy="true" className="flex flex-col gap-3">
          <p className="sr-only" role="status">
            {t("ui.loading")}
          </p>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
        </Card>
      ) : (
        <>
          {/* Desktop and tablet: the month grid. */}
          <Card elevation="flat" padding="none" className="hidden md:block">
            <div role="table" aria-label={formatMonthLabel(month)} className="w-full">
              <div role="row" className="grid grid-cols-7 border-b border-border bg-neutral-50">
                {weeks[0]?.map((day) => (
                  <div
                    key={day}
                    role="columnheader"
                    className="px-2 py-2 text-center text-sm font-semibold text-text-muted"
                  >
                    {formatWeekdayShort(day)}
                  </div>
                ))}
              </div>
              {weeks.map((week) => (
                <div key={week[0]} role="row" className="grid grid-cols-7">
                  {week.map((day) => {
                    const inMonth = day.startsWith(month);
                    const dayEntries = byDay.get(day) ?? [];
                    return (
                      <div
                        key={day}
                        role="cell"
                        aria-label={formatDayLabel(day)}
                        className={cn(
                          "flex min-h-28 min-w-0 flex-col gap-1 border-b border-e border-border p-1.5",
                          !inMonth && "bg-neutral-50",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex size-7 items-center justify-center self-start rounded-full text-sm font-semibold tabular-nums",
                            day === today ? "bg-primary text-on-primary" : "text-text-muted",
                          )}
                        >
                          {dayNumber(day)}
                        </span>
                        {dayEntries.map((entry) => (
                          <EntryChip key={entry.key} entry={entry} timeZone={timeZone} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>

          {/* Phone: an agenda grouped by day, no grid. */}
          <div className="flex flex-col gap-4 md:hidden">
            {agenda.length === 0 ? (
              <Card elevation="flat">
                <p className="text-text-muted">{t("admin.content.calendar.empty")}</p>
              </Card>
            ) : (
              agenda.map((day) => (
                <section key={day} aria-label={formatDayLabel(day)} className="flex flex-col gap-2">
                  <h3
                    className={cn(
                      "text-base font-semibold",
                      day === today ? "text-primary" : "text-text",
                    )}
                  >
                    {formatDayLabel(day)}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {(byDay.get(day) ?? []).map((entry) => (
                      <li key={entry.key}>
                        <EntryChip entry={entry} timeZone={timeZone} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>

          <ul
            aria-label={t("admin.content.calendar.legend")}
            className="flex flex-wrap gap-4 text-sm text-text-muted"
          >
            <li className="flex items-center gap-1.5">
              <Clock aria-hidden className="size-4 text-primary" />
              {t("admin.content.calendar.kind.scheduled")}
            </li>
            <li className="flex items-center gap-1.5">
              <CalendarCheck aria-hidden className="size-4 text-success" />
              {t("admin.content.calendar.kind.published")}
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
