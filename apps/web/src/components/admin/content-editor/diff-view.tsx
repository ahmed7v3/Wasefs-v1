"use client";

import { diffWords, diffStats, type DiffOp } from "@wasfa/shared/content";
import { t } from "@wasfa/shared/i18n";
import { useMemo } from "react";

export interface DiffViewProps {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}

const BLOCK =
  "whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-3 text-base leading-relaxed";

/*
 * Added text is underlined on a tinted background, removed text is struck through: the meaning never
 * depends on colour alone (WCAG 1.4.1). `dir="auto"` per block so an Arabic body with English drug names
 * keeps its reading order; the diff itself is word level (`diffWords`, shared with the revision stats).
 */
function Inline({ ops, show }: { ops: readonly DiffOp[]; show: "both" | "before" | "after" }) {
  return (
    <>
      {ops.map((op, index) => {
        if (op.type === "equal") return <span key={index}>{op.text}</span>;
        if (op.type === "add") {
          return show === "before" ? null : (
            <ins
              key={index}
              className="bg-success-soft text-text underline decoration-success decoration-2"
            >
              {op.text}
            </ins>
          );
        }
        return show === "after" ? null : (
          <del
            key={index}
            className="bg-danger-soft text-text line-through decoration-danger decoration-2"
          >
            {op.text}
          </del>
        );
      })}
    </>
  );
}

/** Stacked on phones (one inline diff), side by side from `lg` (before | after). */
export function DiffView({ before, after, beforeLabel, afterLabel }: DiffViewProps) {
  const ops = useMemo(() => diffWords(before, after), [before, after]);
  const stats = useMemo(() => diffStats(ops), [ops]);
  const unchanged = before === after;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted" role="status">
        {unchanged ? t("admin.editor.diff.none") : t("admin.editor.diff.stats", stats)}
      </p>
      {unchanged ? null : (
        <>
          <div dir="auto" className={`${BLOCK} lg:hidden`} data-testid="diff-stacked">
            <Inline ops={ops} show="both" />
          </div>
          <div className="hidden gap-3 lg:grid lg:grid-cols-2" data-testid="diff-side-by-side">
            <section aria-label={beforeLabel} className="flex min-w-0 flex-col gap-1">
              <h4 className="text-sm font-semibold text-text-muted">{beforeLabel}</h4>
              <div dir="auto" className={BLOCK}>
                <Inline ops={ops} show="before" />
              </div>
            </section>
            <section aria-label={afterLabel} className="flex min-w-0 flex-col gap-1">
              <h4 className="text-sm font-semibold text-text-muted">{afterLabel}</h4>
              <div dir="auto" className={BLOCK}>
                <Inline ops={ops} show="after" />
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
