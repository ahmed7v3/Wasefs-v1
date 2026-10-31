import { Badge, Container } from "@wasfa/ui";
import { ArrowRight, Check, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { landingFor } from "../../content/landing-locale";
import { localizedPath, type Locale } from "../../lib/locale";

import { MedCard } from "./chat-parts";
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

const READER_PATH = "/features/prescription-reader";

function numberFormat(locale: Locale, westernDigits: boolean): Intl.NumberFormat {
  const tag = locale === "ar" ? `ar-EG-u-nu-${westernDigits ? "latn" : "arab"}` : "en";
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
}

/** The scribbled line of stage 1; the highlight box under it is the reading window. */
const SCRIBBLE = "M6 30q5-14 10 0t10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0";

/** The mini picture of one stage; the same sample line travels through all four. */
function StageVisual({ index, locale }: { index: number; locale: Locale }) {
  const { precision } = landingFor(locale);
  const { sample } = precision;
  return (
    <div className="rounded-2xl border border-border bg-surface p-3.5">
      {index === 0 ? (
        <div>
          <svg
            viewBox="0 0 132 48"
            className="h-14 w-full"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="2" y="4" width="128" height="40" rx="8" fill="#f7f3e8" />
            <path
              d={SCRIBBLE}
              stroke="#2b3a6b"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="3"
              y="9"
              width="126"
              height="30"
              rx="6"
              fill="#60a5fa"
              fillOpacity="0.16"
              stroke="#1e3a8a"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          </svg>
          <p className="mt-2.5 text-sm text-text-muted">{sample.readLabel}</p>
          <p dir="ltr" className="text-start text-lg font-bold text-text">
            {sample.scribble}
          </p>
        </div>
      ) : null}
      {index === 1 ? (
        <div>
          <p className="text-sm text-text-muted">{sample.candidatesLabel}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {sample.candidates.map((name, position) => (
              <li
                key={name}
                dir="ltr"
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-start text-base ${
                  position === 0
                    ? "border-primary/40 bg-primary-soft font-bold text-text"
                    : "border-border text-text-muted"
                }`}
              >
                {position === 0 ? (
                  <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />
                ) : (
                  <span aria-hidden="true" className="size-4 shrink-0" />
                )}
                {name}
                {position === 0 ? (
                  <Badge tone="success" className="ms-auto px-2 py-0 text-xs">
                    {sample.confidence}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-sm text-text-muted">
            {sample.ingredientLabel}:{" "}
            <span className="font-bold text-text">{sample.ingredient}</span>
          </p>
        </div>
      ) : null}
      {index === 2 ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-xl border border-border bg-bg-warm px-3 py-2">
            <p className="text-sm text-text-muted">{sample.doseLabel}</p>
            <p className="text-base font-bold text-text">
              <bdi>{sample.dose}</bdi>
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-sm font-bold text-success">
              <ShieldCheck aria-hidden="true" className="size-4" />
              {sample.doseOk}
            </p>
          </div>
          <div className="rounded-xl border border-warning/40 bg-warning-soft px-3 py-2">
            <Badge tone="warning" className="bg-surface px-2 py-0.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              {sample.duplicateBadge}
            </Badge>
            <p className="mt-1 text-sm text-text">{sample.duplicateNote}</p>
          </div>
        </div>
      ) : null}
      {index === 3 ? (
        <MedCard
          item={{ name: sample.resultName, dose: sample.resultDetail, times: sample.resultTimes }}
          className="border-success/40"
        />
      ) : null}
    </div>
  );
}

/**
 * "The journey of every line in your prescription" (BRAND-AND-HOMEPAGE §3.2): one handwritten line
 * through four stages, a horizontal stepper from `lg` (it follows the reading direction) and a
 * vertical one on a phone. Every word is server-rendered in the stage cards, so the section reads
 * the same without motion or JavaScript; where scroll-driven animation is supported the connector
 * grows as the section enters (`.journey-line`), and that is all the motion there is.
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
      className="border-y border-border/70 bg-linear-to-b from-surface via-primary-soft/40 to-surface py-16 sm:py-24"
    >
      <Container>
        <SectionHeading
          id="precision-title"
          eyebrow={precision.eyebrow}
          title={precision.title}
          lead={precision.lead}
        />
        <p className="mt-3 text-center">
          <Badge tone="info">{precision.sampleBadge}</Badge>
        </p>
        <ol
          aria-label={precision.stepsLabel}
          className="relative mt-10 grid gap-6 lg:grid-cols-4 lg:gap-5"
        >
          {/* Connector: a track and a growing line, vertical on a phone and horizontal from lg. */}
          <div
            aria-hidden="true"
            className="absolute inset-y-6 start-5 w-0.5 rounded-full bg-primary/15 lg:inset-x-[12.5%] lg:inset-y-auto lg:top-5 lg:h-0.5 lg:w-auto"
          >
            <div className="journey-line size-full rounded-full bg-primary" />
          </div>
          {precision.steps.map((step, index) => (
            <li
              key={step.title}
              className="relative grid grid-cols-[2.5rem_1fr] gap-4 lg:grid-cols-1 lg:grid-rows-[auto_1fr] lg:justify-items-center lg:gap-4"
            >
              <span className="relative z-10 grid size-10 place-items-center rounded-full bg-primary text-lg font-bold text-on-primary tabular-nums shadow-card ring-4 ring-surface">
                {numbers.format(index + 1)}
              </span>
              <div className="min-w-0 self-start rounded-3xl lg:h-full lg:self-stretch border border-border bg-surface p-5 shadow-card lg:w-full">
                <h3 className="text-xl font-bold text-text">{step.title}</h3>
                <p className="mt-2 text-base text-text-muted">{step.body}</p>
                <div className="mt-4">
                  <StageVisual index={index} locale={locale} />
                </div>
              </div>
            </li>
          ))}
        </ol>

        {figures.length > 0 ? (
          <div className="mx-auto mt-12 max-w-2xl">
            <dl className="grid gap-4 sm:grid-cols-2">
              {figures.map((figure) => (
                <div
                  key={figure.label}
                  className="rounded-2xl border border-border bg-surface p-4 text-center shadow-card"
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
