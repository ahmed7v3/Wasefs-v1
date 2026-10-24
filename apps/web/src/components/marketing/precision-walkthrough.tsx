import { Badge, Container } from "@wasfa/ui";
import { ArrowRight, Check, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { localizedPath, type Locale } from "../../lib/locale";

import { SectionHeading } from "./section-heading";

/** The admin-published figures of `landing.proof` (null = not published, so not shown). */
export interface PrecisionProof {
  avgAnalysisSeconds: number | null;
  accuracyPercent: number | null;
}

export interface PrecisionWalkthroughProps {
  locale?: Locale;
  proof?: PrecisionProof;
  /** `locale.westernDigits` setting: Arabic text uses 0-9 unless the admin turned it off. */
  westernDigits?: boolean;
}

const STEP_COUNT = 4;
const READER_PATH = "/features/prescription-reader";

function numberFormat(locale: Locale, westernDigits: boolean): Intl.NumberFormat {
  const tag = locale === "ar" ? `ar-EG-u-nu-${westernDigits ? "latn" : "arab"}` : "en";
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
}

/** Handwriting-like stroke for the first step's picture. */
const SCRIBBLE = "M4 22q6-18 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0";

/**
 * The small picture of one stage. The same component fills the card on a phone (and without scroll
 * motion) and the large sticky stage on desktop, so the sample data lives in one place.
 */
function StepVisual({ index, locale }: { index: number; locale: Locale }) {
  const { precision } = landingFor(locale);
  const { sample } = precision;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <Badge tone="info" className="mb-3">
        {precision.sampleBadge}
      </Badge>
      {index === 0 ? (
        <div>
          <svg
            viewBox="0 0 128 44"
            className="h-12 w-full max-w-64"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d={SCRIBBLE}
              className="stroke-neutral-600"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="mt-2 text-sm text-text-muted">{sample.readLabel}</p>
          <p dir="ltr" className="text-start text-lg font-bold text-text">
            {sample.scribble}
          </p>
        </div>
      ) : null}
      {index === 1 ? (
        <div>
          <p className="text-sm text-text-muted">{sample.candidatesLabel}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {sample.candidates.map((name, position) => (
              <li
                key={name}
                dir="ltr"
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-start text-base ${
                  position === 0
                    ? "border-primary/40 bg-primary-soft font-bold text-text"
                    : "border-border text-text-muted"
                }`}
              >
                {position === 0 ? (
                  <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                ) : null}
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-text-muted">
            {sample.ingredientLabel}:{" "}
            <span className="font-bold text-text">{sample.ingredient}</span>
          </p>
        </div>
      ) : null}
      {index === 2 ? (
        <div>
          <p className="text-sm text-text-muted">{sample.rawLabel}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span dir="ltr" className="rounded-lg bg-neutral-100 px-3 py-1 text-lg font-bold">
              {sample.raw}
            </span>
            <ArrowRight aria-hidden="true" className="size-5 text-primary rtl:-scale-x-100" />
            <span className="text-lg font-bold text-text">
              <bdi>{sample.normalized}</bdi>
            </span>
          </div>
        </div>
      ) : null}
      {index === 3 ? (
        <div className="flex flex-col gap-2">
          <p
            dir="ltr"
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-start text-base text-text-muted"
          >
            <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
            {sample.scribble}
          </p>
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
            <p dir="ltr" className="text-start text-base font-bold text-text">
              {sample.flaggedRaw}
            </p>
            <Badge tone="warning" className="mt-1.5 bg-surface">
              <TriangleAlert aria-hidden="true" className="size-4" />
              {sample.flaggedBadge}
            </Badge>
          </div>
          <p className="text-sm text-text-muted">{sample.flaggedNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "What happens to each line of your prescription?" (BRAND-AND-HOMEPAGE §3.2): four stages of one
 * sample line. Every word is server-rendered inside the step cards, so the section reads the same
 * with no motion, no scroll-driven animation support, or no JavaScript.
 *
 * Where scroll-driven animation is available and motion is allowed (globals.css, "Scroll motion"),
 * a desktop reader gets a sticky stage that follows the steps, one picture per stage, driven by
 * each step's view timeline; the in-card pictures then step aside. Phones always get four stacked
 * cards with their own small picture: no sticky, no scroll-jacking.
 */
export function PrecisionWalkthrough({
  locale = "ar",
  proof,
  westernDigits = true,
}: PrecisionWalkthroughProps) {
  const { precision } = landingFor(locale);
  const numbers = numberFormat(locale, westernDigits);
  const figures = [
    proof?.avgAnalysisSeconds == null
      ? null
      : {
          label: precision.proof.avgLabel,
          value: numbers.format(proof.avgAnalysisSeconds),
          unit: precision.proof.avgUnit,
        },
    proof?.accuracyPercent == null
      ? null
      : {
          label: precision.proof.accuracyLabel,
          value: numbers.format(proof.accuracyPercent),
          unit: "%",
        },
  ].filter((figure) => figure !== null);

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
        <div className="motion-story mt-12 grid gap-10">
          <ol
            aria-label={precision.stepsLabel}
            className="mx-auto flex w-full max-w-2xl flex-col gap-6"
          >
            {precision.steps.map((step, index) => (
              <li
                key={step.title}
                className={`motion-story-step motion-story-step-${index + 1} relative grid grid-cols-[2.5rem_1fr] gap-4`}
              >
                <span className="relative z-10 grid size-10 place-items-center rounded-full bg-primary text-lg font-bold text-on-primary tabular-nums ring-4 ring-surface">
                  {numbers.format(index + 1)}
                </span>
                {index < STEP_COUNT - 1 ? (
                  <svg
                    viewBox="0 0 2 100"
                    preserveAspectRatio="none"
                    className="motion-draw absolute start-[19px] top-10 h-[calc(100%-1rem)] w-0.5"
                    fill="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M1 0V100"
                      className="stroke-primary/20"
                      strokeWidth="2"
                      strokeDasharray="none"
                      strokeDashoffset="0"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d="M1 0V100"
                      pathLength="1"
                      className="stroke-primary"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : null}
                <div className="min-w-0 self-start rounded-2xl border border-border bg-bg-warm p-5 shadow-card">
                  <h3 className="text-xl font-bold text-text">{step.title}</h3>
                  <p className="mt-2 text-base text-text-muted">{step.body}</p>
                  <div className="precision-inline-visual mt-4">
                    <StepVisual index={index} locale={locale} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {/* The sticky stage is decorative (the steps carry the words) and shown only with scroll motion. */}
          <div aria-hidden="true" className="precision-sticky">
            <div className="story-stage rounded-2xl border border-border bg-bg-warm p-6 shadow-raised">
              {precision.steps.map((step, index) => (
                <div
                  key={step.title}
                  className={`story-panel story-panel-${index + 1} flex flex-col justify-center gap-3`}
                >
                  <p className="text-lg font-bold text-primary">
                    {numbers.format(index + 1)}. {step.title}
                  </p>
                  <StepVisual index={index} locale={locale} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {figures.length > 0 ? (
          <div className="mx-auto mt-12 max-w-2xl">
            <dl className="grid gap-4 sm:grid-cols-2">
              {figures.map((figure) => (
                <div
                  key={figure.label}
                  className="rounded-xl border border-border bg-bg-warm p-4 text-center"
                >
                  <dt className="text-sm text-text-muted">{figure.label}</dt>
                  <dd className="mt-1 text-3xl font-bold text-primary tabular-nums">
                    {figure.value}{" "}
                    <span className="text-lg font-semibold text-text-muted">{figure.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-center text-sm text-text-muted">{precision.proof.note}</p>
          </div>
        ) : null}

        <p className="mt-10 text-center">
          <Link
            href={localizedPath(READER_PATH, locale)}
            className="inline-flex min-h-12 items-center gap-2 rounded-sm text-lg font-bold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
          >
            {precision.link}
            <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
          </Link>
        </p>
      </Container>
    </section>
  );
}
