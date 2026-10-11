import { ArrowDown, ShieldCheck, TriangleAlert } from "lucide-react";

import { landing } from "../../content/landing";

const { visual } = landing;

/** Wavy strokes that stand for handwriting; decorative, so plain paths with token colours. */
function Handwriting({ widths }: { widths: readonly number[] }) {
  return (
    <svg
      viewBox="0 0 240 72"
      className="h-16 w-full"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {widths.map((width, index) => {
        const y = 12 + index * 22;
        const wave = Array.from({ length: Math.floor(width / 16) }, (_, step) => {
          const x = 8 + step * 16;
          return `${step === 0 ? "M" : "L"}${x} ${y + (step % 2 === 0 ? -5 : 5)}`;
        }).join(" ");
        return <path key={width} d={wave} className="stroke-neutral-400" strokeWidth="3" />;
      })}
    </svg>
  );
}

/**
 * The hero illustration (like the floating panels of `2.png` / `3.png`): a handwritten prescription
 * that becomes a structured result card. Built from HTML, CSS and inline SVG, so it costs no image
 * request, renders real Arabic text and cannot shift the layout. The whole thing is one labelled
 * image for assistive technology; the sample content is illustrative, not a real result.
 */
export function HeroVisual() {
  return (
    <div role="img" aria-label={visual.alt} className="relative mx-auto w-full max-w-md pt-4 pb-6">
      <div className="rounded-2xl bg-primary-soft p-4 shadow-raised sm:p-6">
        <div className="rounded-xl bg-surface p-4 shadow-card">
          <p className="text-sm font-semibold text-text-muted">{visual.paperTitle}</p>
          <Handwriting widths={[176, 144, 160]} />
        </div>

        <div className="flex justify-center py-2 text-primary">
          <ArrowDown aria-hidden="true" className="size-6" />
        </div>

        <div className="reveal-up rounded-xl bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <p className="font-heading text-base font-semibold text-text">{visual.resultTitle}</p>
            <p className="text-sm text-text-muted">{visual.resultMeta}</p>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {visual.items.map((item) => (
              <li
                key={item.name}
                className={
                  item.flag === "review"
                    ? "flex items-start gap-3 rounded-md border border-warning/40 bg-warning-soft p-3"
                    : "flex items-start gap-3 rounded-md bg-bg p-3"
                }
              >
                <span
                  className={
                    item.flag === "review"
                      ? "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface text-warning"
                      : "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"
                  }
                >
                  {item.flag === "review" ? (
                    <TriangleAlert aria-hidden="true" className="size-4" />
                  ) : (
                    <ShieldCheck aria-hidden="true" className="size-4" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-text">{item.name}</span>
                  <span className="block text-sm text-text-muted">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <span className="float-slow absolute end-3 top-0 rounded-full bg-surface px-3 py-1 text-sm font-semibold text-success shadow-card">
        {visual.confidenceHigh}
      </span>
      <span className="float-slow absolute start-3 bottom-0 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary shadow-card [animation-delay:1.2s]">
        {visual.note}
      </span>
    </div>
  );
}
