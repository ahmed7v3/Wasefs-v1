import type { ReactNode } from "react";

export interface DetailItem {
  label: string;
  value: ReactNode;
}

/** Label/value pairs of a detail view; a value of `null` or `undefined` renders as an em dash. */
export function DetailList({ items }: { items: readonly DetailItem[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-3 text-base">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-sm text-text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words">
            {item.value === null || item.value === undefined || item.value === ""
              ? "—"
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled block inside a drawer. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-heading text-lg font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}
