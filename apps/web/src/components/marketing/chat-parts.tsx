import { cn } from "@wasfa/ui";
import { Check, FileText, MessageCircle, Moon, Play, Sun } from "lucide-react";

import type { SceneItem, SceneTime } from "../../content/landing";
import type { ReactNode } from "react";

/*
 * The pieces of the homepage chat mocks: a phone, a WhatsApp-style chat, the medicine card with its
 * schedule chips, a PDF bubble, a voice note and the prescription drawn as inline SVG. Shared by
 * the hero, the WhatsApp section, the journey stepper and the app band, so the sample data and the
 * look live in one place. Everything here is decorative: the section that uses it supplies the one
 * accessible label. Text colours keep AA contrast on their own surface because axe also reads
 * text that is hidden from assistive technology.
 */

/** The ink of the handwriting: a pen blue, a little darker than the brand navy. */
const INK = "#2b3a6b";

export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" />
      <path
        d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4 4 0 0 1-2.2-2.2l.8-1-1-2L9 8.5Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** A phone: dark bezel, notch and a screen that clips its content. The caller sets the size. */
export function PhoneShell({
  children,
  className,
  screenClassName,
}: {
  children: ReactNode;
  className?: string | undefined;
  screenClassName?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "relative w-68 rounded-[2.5rem] bg-neutral-900 p-2 shadow-[0_40px_70px_-30px_rgb(7_94_84/0.5),0_18px_30px_-18px_rgb(11_18_32/0.5)] ring-1 ring-white/15",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-3.5 z-10 mx-auto block h-1.5 w-14 rounded-full bg-neutral-900"
      />
      <div className={cn("overflow-hidden rounded-[2rem]", screenClassName)}>{children}</div>
    </div>
  );
}

/** The green chat header: avatar, name and status. */
export function ChatHeader({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-wa-deep px-3.5 pt-7 pb-2.5 text-white">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-wa-deep">
        <MessageCircle aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-bold">{name}</p>
        <p className="text-xs text-white/90">{status}</p>
      </div>
    </div>
  );
}

/** One chat bubble. `user` bubbles sit at the inline end (green), the assistant's at the start (white). */
export function Bubble({
  from,
  children,
  className,
}: {
  from: "user" | "agent";
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "max-w-[88%] rounded-2xl p-2 text-[0.8125rem] leading-snug text-text shadow-[0_1px_1px_rgb(11_18_32/0.14)]",
        from === "user"
          ? "self-end rounded-ee-sm bg-wa-bubble"
          : "self-start rounded-es-sm bg-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TimeIcon({ kind }: { kind: SceneTime["kind"] }) {
  return kind === "sun" ? (
    <Sun aria-hidden="true" className="size-3 text-warning" />
  ) : (
    <Moon aria-hidden="true" className="size-3 text-primary" />
  );
}

/** The schedule row: a sun or moon and the dose time. */
export function TimeChips({ times }: { times: readonly SceneTime[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {times.map((time) => (
        <li
          key={`${time.kind}-${time.label}`}
          className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[0.6875rem] font-bold text-primary"
        >
          <TimeIcon kind={time.kind} />
          <bdi>{time.label}</bdi>
        </li>
      ))}
    </ul>
  );
}

/** A medicine with its dose line and schedule chips. */
export function MedCard({
  item,
  className,
}: {
  item: Pick<SceneItem, "name" | "times"> & { dose: string };
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-white p-2 ps-2.5 shadow-[inset_3px_0_0_var(--color-primary)] rtl:shadow-[inset_-3px_0_0_var(--color-primary)]",
        className,
      )}
    >
      <p className="flex items-center gap-1 text-[0.8125rem] font-bold text-text">
        <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />
        <span className="min-w-0">{item.name}</span>
      </p>
      <p className="mt-0.5 text-xs text-text-muted">{item.dose}</p>
      <div className="mt-1.5">
        <TimeChips times={item.times} />
      </div>
    </div>
  );
}

export function PdfBubble({
  name,
  meta,
  className,
}: {
  name: string;
  meta: string;
  className?: string;
}) {
  return (
    <Bubble from="agent" className={cn("flex items-center gap-2.5 pe-4", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger">
        <FileText aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-xs font-bold">{name}</span>
        <span className="block text-xs text-text-muted">{meta}</span>
      </span>
    </Bubble>
  );
}

/** Deterministic bar heights of the voice waveform. */
const WAVE = [6, 12, 8, 16, 10, 5, 14, 18, 9, 13, 6, 11, 17, 8, 12, 5, 15, 10, 7, 13, 9, 16, 6, 11];
const WAVE_PATH = WAVE.map((h, i) => `M${3 + i * 4} ${11 - h / 2}v${h}`).join("");

export function VoiceBubble({
  from,
  length,
  label,
  className,
}: {
  from: "user" | "agent";
  length: string;
  label?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <Bubble from={from} className={cn("flex items-center gap-2 pe-3", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-wa-deep text-white">
        <Play aria-hidden="true" className="size-4 fill-current rtl:-scale-x-100" />
      </span>
      <span className="min-w-0">
        <svg
          viewBox="0 0 98 22"
          className="block h-5 w-24 text-wa-teal"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d={WAVE_PATH} />
        </svg>
        <span className="block text-xs text-text-muted">
          {label ? `${label} · ` : null}
          <bdi>{length}</bdi>
        </span>
      </span>
    </Bubble>
  );
}

/** The prescription photo: a paper sheet with a pen-blue header, handwriting strokes and a signature. */
export function RxPhoto({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 84"
      direction="ltr"
      className={cn("block h-auto w-full rounded-lg", className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="120" height="84" fill="#f7f3e8" />
      <path d="M0 0h120v10H0z" fill="#e3eafb" />
      <path d="M10 5h30" stroke="#1e3a8a" strokeWidth="2" strokeLinecap="round" />
      <text x="96" y="30" fontSize="17" fontStyle="italic" fontFamily="serif" fill="#1e3a8a">
        Rx
      </text>
      <g fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 28q4-9 8 0t8 0 8 0 8 0 8 0 8 0" />
        <path d="M10 42q3-8 6 0t6 0 6 0 6 0 6 0 6 0 6 0 6 0 6 0" />
        <path d="M10 56q5-9 10 0t10 0 10 0 10 0 10 0" />
        <path d="M80 68c6-12 12 4 18-4s-8-6-4 2 12 4 18-4" strokeWidth="1.4" />
      </g>
      <path d="M12 41h13" stroke="#60a5fa" strokeWidth="9" strokeOpacity="0.28" />
    </svg>
  );
}

/** The larger paper sheet tilted behind the hero phone. */
export function PaperRx({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 176 232"
      direction="ltr"
      className={cn("block h-auto w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="174"
        height="230"
        rx="10"
        fill="#fbf8ef"
        stroke="#e5dfcc"
        strokeWidth="2"
      />
      <path d="M1 11a10 10 0 0 1 10-10h154a10 10 0 0 1 10 10v26H1z" fill="#e3eafb" />
      <path d="M16 14h54M16 26h34" stroke="#1e3a8a" strokeWidth="3" strokeLinecap="round" />
      <circle cx="148" cy="20" r="9" fill="none" stroke="#1e3a8a" strokeWidth="2" />
      <path d="M148 14v12M142 20h12" stroke="#1e3a8a" strokeWidth="2" strokeLinecap="round" />
      <text x="16" y="72" fontSize="30" fontStyle="italic" fontFamily="serif" fill="#1e3a8a">
        Rx
      </text>
      <g fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 98q6-13 12 0t12 0 12 0 12 0 12 0 12 0 12 0" />
        <path d="M18 122q5-12 10 0t10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0" />
        <path d="M18 146q7-14 14 0t14 0 14 0 14 0 14 0" />
        <path d="M18 170q5-12 10 0t10 0 10 0 10 0 10 0 10 0" />
        <path d="M104 206c8-16 16 6 24-6s-10-8-6 3 16 5 26-6" strokeWidth="2" />
      </g>
      <path d="M18 117h34" stroke="#60a5fa" strokeWidth="14" strokeOpacity="0.25" />
    </svg>
  );
}
