"use client";

import { t } from "@wasfa/shared/i18n";
import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../cn";

export interface CountdownProps {
  /**
   * The server's end time (ISO). Without one nothing renders: a countdown exists only for a real,
   * enforced deadline (GROWTH-STRATEGY §2), never as decoration.
   */
  endsAt: string | null | undefined;
  className?: string | undefined;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3 أيام و4 ساعات", "5 ساعات و12 دقيقة" or, in the last hour, "12 دقيقة" (seconds only when motion is allowed). */
export function remainingText(ms: number, withSeconds: boolean): string {
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const seconds = Math.floor((ms % MINUTE) / SECOND);
  if (days > 0) return t("billing.countdown.daysHours", { days, hours });
  if (hours > 0) return t("billing.countdown.hoursMinutes", { hours, minutes });
  if (withSeconds) return t("billing.countdown.minutesSeconds", { minutes, seconds });
  return t("billing.countdown.minutes", { minutes: Math.max(1, minutes) });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Time left on a promotion, from the end time the server sent (a reload never resets it). It ticks
 * every second only in the last hour and only when the person has not asked for reduced motion;
 * otherwise it refreshes once a minute. Nothing is rendered before mount (the text depends on the
 * clock) or once the time is up.
 */
export function Countdown({ endsAt, className }: CountdownProps) {
  const end = endsAt ? Date.parse(endsAt) : Number.NaN;
  const [now, setNow] = useState<number | null>(null);
  const [calm, setCalm] = useState(true);

  useEffect(() => {
    if (Number.isNaN(end)) return;
    setCalm(prefersReducedMotion());
    setNow(Date.now());
    const timer = window.setInterval(
      () => {
        setNow(Date.now());
      },
      end - Date.now() < HOUR && !prefersReducedMotion() ? SECOND : MINUTE,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [end]);

  if (Number.isNaN(end) || now === null || end <= now) return null;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-warning",
        className,
      )}
    >
      <Clock aria-hidden className="size-4" />
      <span>{t("billing.countdown.endsIn", { time: remainingText(end - now, !calm) })}</span>
    </p>
  );
}
