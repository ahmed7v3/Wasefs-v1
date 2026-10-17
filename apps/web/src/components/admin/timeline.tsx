import type { ReactNode } from "react";

export interface TimelineEntry {
  key: string;
  title: string;
  /** Ready text of the time (the caller formats it). */
  time: string;
  detail?: ReactNode;
}

/** A vertical list of events, oldest first as given: a dot, the title, the time, optional detail. */
export function Timeline({ entries, label }: { entries: readonly TimelineEntry[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-3 border-s border-border ps-4">
      {entries.map((entry) => (
        <li key={entry.key} className="relative flex flex-col gap-0.5">
          <span
            aria-hidden
            className="absolute -start-[1.3125rem] top-2 size-2.5 rounded-full bg-primary"
          />
          <span className="text-base font-semibold text-text">{entry.title}</span>
          <span className="text-sm tabular-nums text-text-muted">{entry.time}</span>
          {entry.detail ? <span className="text-sm text-text">{entry.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}
