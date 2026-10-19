import { Badge, Container } from "@wasfa/ui";
import { Database, Eye, Gauge, ScanLine, ShieldCheck, Timer, TriangleAlert } from "lucide-react";

import { type PipelineIcon } from "../../content/landing";
import { landingFor } from "../../content/landing-locale";

import { SectionHeading } from "./section-heading";

import type { Locale } from "../../lib/locale";

const ICONS = {
  scan: ScanLine,
  read: Eye,
  database: Database,
  gauge: Gauge,
} as const satisfies Record<PipelineIcon, unknown>;

/** One 6 s loop: each stage lights 1.5 s after the previous one (see `.pipe-step` in globals.css). */
const STEP_DELAYS = [
  "[animation-delay:0s]",
  "[animation-delay:1.5s]",
  "[animation-delay:3s]",
  "[animation-delay:4.5s]",
] as const;

/** The result rows appear in turn once the stages are through. */
const RESULT_CLASSES = ["pipe-result-1", "pipe-result-2", "pipe-result-3"] as const;

/** Handwriting of the sample prescription: a name line and a shorter dose line per medicine. */
const GROUPS = [
  { y: 58, name: 150, dose: 96 },
  { y: 110, name: 126, dose: 112 },
  { y: 162, name: 140, dose: 84 },
] as const;

function wave(y: number, width: number): string {
  const steps = Math.floor(width / 14);
  return Array.from({ length: steps }, (_, step) => {
    const x = 12 + step * 14;
    return `${step === 0 ? "M" : "L"}${x} ${y + (step % 2 === 0 ? -5 : 5)}`;
  }).join(" ");
}

function Paper({ locale }: { locale: Locale }) {
  const { precision } = landingFor(locale);
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-bold text-text">{precision.paperTitle}</p>
        <span dir="ltr" className="text-xl font-bold text-primary">
          Rx
        </span>
      </div>
      <svg
        viewBox="0 0 220 236"
        className="mt-3 h-auto w-full flex-1"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M12 14h72" className="stroke-primary" strokeWidth="5" />
        <path d="M12 28h44" className="stroke-neutral-300" strokeWidth="3" />
        {GROUPS.map((group, index) => {
          const unclear = index === GROUPS.length - 1;
          return (
            <g key={group.y}>
              <path
                d={wave(group.y, group.name)}
                className={unclear ? "stroke-warning" : "stroke-neutral-600"}
                strokeWidth="3.5"
                strokeDasharray={unclear ? "2 7" : undefined}
              />
              <path
                d={wave(group.y + 24, group.dose)}
                className={unclear ? "stroke-warning" : "stroke-neutral-400"}
                strokeWidth="2.5"
                strokeDasharray={unclear ? "2 7" : undefined}
              />
            </g>
          );
        })}
        <path
          d="M128 222c8-18 14-18 14-4s6 10 12-2 10-8 16 2 12 0 18-4"
          className="stroke-primary/60"
          strokeWidth="3"
        />
      </svg>
      {/* The scanning band; hidden under reduced motion. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="pipe-scan h-1/5 w-full border-b-2 border-mascot-blue bg-linear-to-b from-transparent to-mascot-blue/30" />
      </div>
    </div>
  );
}

function Pipeline({ locale }: { locale: Locale }) {
  const { precision } = landingFor(locale);
  return (
    <div className="flex flex-col gap-3">
      <p className="inline-flex items-center gap-2 self-center rounded-full bg-primary px-4 py-1 text-sm font-bold text-on-primary">
        <Timer aria-hidden="true" className="size-4" />
        {precision.speedBadge}
      </p>
      <ol className="flex flex-col gap-3" aria-label={precision.pipelineTitle}>
        {precision.steps.map((step, index) => {
          const Icon = ICONS[step.icon];
          return (
            <li
              key={step.title}
              className="relative flex items-start gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <span
                aria-hidden="true"
                className={`pipe-step absolute inset-0 rounded-xl bg-primary-soft ring-1 ring-primary/40 ${STEP_DELAYS[index] ?? ""}`}
              />
              <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-neutral-100 text-neutral-600">
                <Icon aria-hidden="true" className="size-5" />
                <span
                  aria-hidden="true"
                  className={`pipe-step absolute inset-0 grid place-items-center rounded-full bg-primary text-on-primary ${STEP_DELAYS[index] ?? ""}`}
                >
                  <Icon className="size-5" />
                </span>
              </span>
              <div className="relative min-w-0">
                <h3 className="text-base font-bold text-text">
                  <span className="text-text-muted tabular-nums">{index + 1}.</span> {step.title}
                </h3>
                <p className="mt-0.5 text-sm text-text-muted">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Result({ locale }: { locale: Locale }) {
  const { precision, visual } = landingFor(locale);
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-raised">
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-bold text-text">{precision.resultTitle}</p>
        <p className="text-sm text-text-muted">{visual.resultMeta}</p>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {visual.items.map((item, index) => {
          const review = item.flag === "review";
          return (
            <li
              key={item.name}
              className={`${RESULT_CLASSES[index] ?? ""} rounded-xl border p-3 ${
                review ? "border-warning/40 bg-warning-soft" : "border-border bg-bg-warm"
              }`}
            >
              <p className="text-base font-bold text-text">{item.name}</p>
              <p className="text-sm text-text-muted">{item.detail}</p>
              <Badge tone={review ? "warning" : "success"} className="mt-2">
                {review ? (
                  <TriangleAlert aria-hidden="true" className="size-4" />
                ) : (
                  <ShieldCheck aria-hidden="true" className="size-4" />
                )}
                {review ? visual.review : visual.confidenceHigh}
              </Badge>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-text-muted">{precision.reviewNote}</p>
    </div>
  );
}

/**
 * Speed and precision, shown instead of claimed: a sample prescription, the four verification
 * stages lighting in turn, and a result in which the uncertain line is flagged, not guessed.
 * Pure CSS motion (6 s loop); without motion every stage is lit and every result row visible.
 */
export function PrecisionDemo({ locale = "ar" }: { locale?: Locale }) {
  const { precision } = landingFor(locale);
  return (
    <section
      id={precision.id}
      aria-labelledby="precision-title"
      className="border-y border-border/70 bg-surface py-16 sm:py-24"
    >
      <Container>
        <SectionHeading
          id="precision-title"
          eyebrow={precision.eyebrow}
          title={precision.title}
          lead={precision.lead}
        />
        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-[1fr_1.15fr_1fr]">
          <Paper locale={locale} />
          <Pipeline locale={locale} />
          <Result locale={locale} />
        </div>
        <p className="mt-6 text-center text-sm text-text-muted">
          {precision.sampleBadge} · {precision.guarantee}
        </p>
      </Container>
    </section>
  );
}
