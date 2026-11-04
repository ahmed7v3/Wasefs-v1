"use client";

import { fromMinor } from "@wasfa/shared/money";
import {
  EARLY_FEATURES,
  EARLY_PROBE_ANSWERS,
  EARLY_ROLE_CHOICES,
  earlyDetailsResponseSchema,
  middleTier,
  type EarlyDetailsResponse,
  type EarlyFeature,
  type EarlyJoinResponse,
  type EarlyProbeAnswer,
  type EarlyRole,
} from "@wasfa/shared/schemas/early-access";
import { ArrowRight, Check, Copy, MessageCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { early } from "../../content/early";
import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { EARLY_ORIGIN } from "../../lib/early-host";
import { ping } from "../../lib/early-tracking";

import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

const copy = early.sheet;
const STEPS = 5;

/** `49 ج.م`, `2.99 $`: whole amounts lose their `.00`; the symbol is the Arabic currency abbreviation. */
export function formatEarlyPrice(amountMinor: number, currency: string): string {
  const amount = fromMinor(amountMinor, currency).replace(/\.00$/, "");
  return `${amount} ${early.currencySymbols[currency] ?? currency}`;
}

const chip =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-[15px] font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:shadow-focus";
const chipOff =
  "border-[#0b1220]/12 bg-white text-[#0b1220] hover:border-[#1e3a8a]/40 hover:bg-[#e3eafb]/60";
const chipOn = "border-[#1e3a8a] bg-[#1e3a8a] text-white";
const primary =
  "inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#1e3a8a] px-7 text-base font-bold text-white shadow-[0_8px_20px_-8px_rgb(30_58_138/0.7)] transition-colors hover:bg-[#172e6e] focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50";

interface SheetProps {
  join: EarlyJoinResponse;
  details: EarlyDetailsResponse | null;
  onDetails: (details: EarlyDetailsResponse) => void;
  onClose: () => void;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])';

/**
 * Step 2 of the sign-up (the phone is already saved). Bottom sheet on mobile, centred panel on
 * desktop. Focus is trapped inside, Escape closes, the page behind does not scroll. Every answer is
 * one tap; only the name needs typing.
 */
export function EarlyDetailsSheet({ join, details, onDetails, onClose }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState<EarlyRole | null>(null);
  const [probe, setProbe] = useState<EarlyProbeAnswer | null>(null);
  // `undefined` = not answered yet; `null` = "free only".
  const [fair, setFair] = useState<number | null | undefined>(undefined);
  const [features, setFeatures] = useState<EarlyFeature[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Focus trap, Escape, scroll lock, and focus restore (the page's phone bar gets focus back).
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingRight } = document.body.style;
    document.body.style.overflow = "hidden";
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null,
      );
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      previous?.focus();
    };
  }, []);

  // Each step moves focus to its question (the name step to its input), so screen readers announce it.
  useEffect(() => {
    if (step === 0 && !details) nameRef.current?.focus();
    else headingRef.current?.focus();
  }, [step, details]);

  async function submit(chosen: EarlyFeature[]) {
    if (!role || !probe || fair === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/public/early-access/join/${join.signupId}`, {
        method: "PATCH",
        headers: { "x-early-token": join.token },
        body: {
          name: name.trim(),
          role,
          probeAnswer: probe,
          fairPriceMinor: fair,
          features: chosen,
        },
        schema: earlyDetailsResponseSchema,
      });
      onDetails(result);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setStep((s) => Math.min(s + 1, STEPS - 1));
  }

  function onNameKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && name.trim().length >= 2) {
      event.preventDefault();
      next();
    }
  }

  const suggested = middleTier(join.ladder);
  const price = formatEarlyPrice(join.probe.priceMinor, join.probe.currency);
  const done = details !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="early-sheet-backdrop absolute inset-0 bg-[#0b1220]/55 sm:bg-[#0b1220]/45 sm:backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="early-sheet relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-[28px] bg-[#fbfbf9] shadow-[0_-8px_40px_-8px_rgb(11_18_32/0.35)] sm:max-w-lg sm:rounded-[28px] sm:shadow-[0_32px_80px_-16px_rgb(11_18_32/0.45)]"
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-7 sm:pt-6">
          {done ? (
            <span />
          ) : (
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label={copy.stepOf(step + 1, STEPS)}
            >
              {Array.from({ length: STEPS }, (_, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step
                      ? "w-7 bg-[#1e3a8a]"
                      : i < step
                        ? "w-3 bg-[#1e3a8a]/50"
                        : "w-3 bg-[#0b1220]/12"
                  }`}
                />
              ))}
              <span className="sr-only">{copy.stepOf(step + 1, STEPS)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="grid size-10 place-items-center rounded-full text-[#4a5670] transition-colors hover:bg-[#0b1220]/6 focus-visible:outline-none focus-visible:shadow-focus"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 pb-6 pt-3 sm:px-7 sm:pb-8">
          {done ? (
            <Success
              details={details}
              titleId={titleId}
              headingRef={headingRef}
              onClose={onClose}
            />
          ) : (
            <div key={step} className="early-step">
              {step === 0 ? (
                <>
                  <h2
                    id={titleId}
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold outline-none"
                  >
                    {copy.name.q}
                  </h2>
                  <p className="mt-1 text-[15px] text-[#4a5670]">{copy.saved}</p>
                  <label htmlFor={`${titleId}-name`} className="sr-only">
                    {copy.name.q}
                  </label>
                  <input
                    id={`${titleId}-name`}
                    ref={nameRef}
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    placeholder={copy.name.placeholder}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    onKeyDown={onNameKey}
                    className="mt-5 min-h-14 w-full rounded-2xl border border-[#0b1220]/12 bg-white px-4 text-lg text-[#0b1220] placeholder:text-[#8792a8] focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/40"
                  />
                  <p className="mt-2 text-sm text-[#64708a]">{copy.name.hint}</p>
                  <div className="mt-6">
                    <button
                      type="button"
                      disabled={name.trim().length < 2}
                      onClick={next}
                      className={`${primary} w-full sm:w-auto`}
                    >
                      {copy.next}
                    </button>
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <h2
                    id={titleId}
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold outline-none"
                  >
                    {copy.role.q}
                  </h2>
                  <div
                    role="radiogroup"
                    aria-labelledby={titleId}
                    className="mt-5 flex flex-wrap gap-2.5"
                  >
                    {EARLY_ROLE_CHOICES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={role === r}
                        onClick={() => {
                          setRole(r);
                          next();
                        }}
                        className={`${chip} ${role === r ? chipOn : chipOff}`}
                      >
                        {early.roles[r]}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <h2
                    id={titleId}
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold leading-snug outline-none"
                  >
                    {copy.probe.q(price)}
                  </h2>
                  <p className="mt-1 text-[15px] text-[#4a5670]">{copy.probe.value}</p>
                  <div
                    role="radiogroup"
                    aria-labelledby={titleId}
                    className="mt-5 grid grid-cols-3 gap-2.5"
                  >
                    {EARLY_PROBE_ANSWERS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        role="radio"
                        aria-checked={probe === a}
                        onClick={() => {
                          setProbe(a);
                          next();
                        }}
                        className={`${chip} min-h-14 text-base ${probe === a ? chipOn : chipOff}`}
                      >
                        {copy.probe[a]}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <h2
                    id={titleId}
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold leading-snug outline-none"
                  >
                    {copy.fair.q}
                  </h2>
                  <div
                    role="radiogroup"
                    aria-labelledby={titleId}
                    className="mt-5 flex flex-wrap gap-2.5"
                  >
                    {[...join.ladder]
                      .sort((x, y) => y - x)
                      .map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          role="radio"
                          aria-checked={fair === amount}
                          onClick={() => {
                            setFair(amount);
                            next();
                          }}
                          className={`${chip} ${fair === amount ? chipOn : chipOff}`}
                        >
                          {formatEarlyPrice(amount, join.probe.currency)}
                          {amount === suggested ? (
                            <span
                              className={`rounded-full px-2 text-xs font-bold ${
                                fair === amount
                                  ? "bg-white/20 text-white"
                                  : "bg-[#dcfce7] text-[#15803d]"
                              }`}
                            >
                              {copy.fair.suggested}
                            </span>
                          ) : null}
                        </button>
                      ))}
                  </div>
                  {join.allowFree ? (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={fair === null}
                      onClick={() => {
                        setFair(null);
                        next();
                      }}
                      className={`mt-3 min-h-11 rounded-xl px-3 text-sm font-semibold underline-offset-4 hover:underline ${
                        fair === null ? "bg-[#1e3a8a] text-white" : "text-[#64708a]"
                      }`}
                    >
                      {copy.fair.free}
                    </button>
                  ) : null}
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <h2
                    id={titleId}
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-2xl font-bold outline-none"
                  >
                    {copy.features.q}
                  </h2>
                  <p className="mt-1 text-[15px] text-[#4a5670]">{copy.features.hint}</p>
                  <div
                    role="group"
                    aria-labelledby={titleId}
                    className="mt-5 flex flex-wrap gap-2.5"
                  >
                    {EARLY_FEATURES.map((f) => {
                      const on = features.includes(f);
                      return (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setFeatures((list) =>
                              on ? list.filter((x) => x !== f) : [...list, f],
                            );
                          }}
                          className={`${chip} ${on ? chipOn : chipOff}`}
                        >
                          {on ? (
                            <Check className="size-4" aria-hidden="true" strokeWidth={3} />
                          ) : null}
                          {early.featureLabels[f]}
                        </button>
                      );
                    })}
                  </div>
                  {error ? (
                    <p role="alert" className="mt-4 text-sm text-[#b91c1c]">
                      {error}
                    </p>
                  ) : null}
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submit(features)}
                      className={`${primary} flex-1 sm:flex-none`}
                    >
                      {busy ? copy.sending : copy.confirm}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setFeatures([]);
                        void submit([]);
                      }}
                      className="min-h-12 rounded-2xl px-4 font-semibold text-[#4a5670] transition-colors hover:bg-[#0b1220]/6 focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {copy.skip}
                    </button>
                  </div>
                </>
              ) : null}

              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setStep((s) => Math.max(s - 1, 0));
                  }}
                  className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-[#4a5670] hover:text-[#1e3a8a] focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <ArrowRight className="size-4" aria-hidden="true" />
                  {copy.back}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Success({
  details,
  titleId,
  headingRef,
  onClose,
}: {
  details: EarlyDetailsResponse;
  titleId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${EARLY_ORIGIN}/?r=${details.refCode}`;
  const position = `#${details.position.toLocaleString("en-US")}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      ping("share");
      setTimeout(() => {
        setCopied(false);
      }, 2200);
    } catch {
      // Clipboard blocked: the link stays selectable in its field.
    }
  }

  return (
    <div className="early-step relative pt-2 text-center">
      {/* CSS-only celebration; hidden for reduced motion in early.css. */}
      <div
        aria-hidden="true"
        className="early-confetti pointer-events-none absolute inset-x-0 top-0 h-40"
      >
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <span className="early-pop mx-auto grid size-16 place-items-center rounded-full bg-[#dcfce7] text-[#15803d]">
        <Check className="size-8" strokeWidth={3} aria-hidden="true" />
      </span>
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-2xl font-bold outline-none"
      >
        {copy.success.title(position)}
      </h2>
      <p className="mx-auto mt-2 max-w-[34ch] text-[15px] text-[#4a5670]">{copy.success.body}</p>
      <div className="mt-6 text-start">
        <label htmlFor={`${titleId}-link`} className="text-sm font-semibold text-[#4a5670]">
          {copy.success.linkLabel}
        </label>
        <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-[#0b1220]/12 bg-white p-1.5">
          <input
            id={`${titleId}-link`}
            readOnly
            dir="ltr"
            value={link}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-[#0b1220] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#e3eafb] px-3 text-sm font-bold text-[#1e3a8a] transition-colors hover:bg-[#d3dffa] focus-visible:outline-none focus-visible:shadow-focus"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            <span aria-live="polite">{copied ? copy.success.copied : copy.success.copy}</span>
          </button>
        </div>
      </div>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(copy.success.shareText(link))}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          ping("share");
        }}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#128c7e] px-6 text-base font-bold text-white transition-colors hover:bg-[#075e54] focus-visible:outline-none focus-visible:shadow-focus"
      >
        <MessageCircle className="size-5" aria-hidden="true" />
        {copy.success.whatsapp}
      </a>
      {details.invited > 0 ? (
        <p className="mt-3 text-sm text-[#4a5670]">
          {copy.success.invited(details.invited.toLocaleString("en-US"))}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="mt-4 min-h-11 rounded-xl px-4 text-sm font-semibold text-[#4a5670] hover:text-[#1e3a8a] focus-visible:outline-none focus-visible:shadow-focus"
      >
        {copy.success.done}
      </button>
    </div>
  );
}
