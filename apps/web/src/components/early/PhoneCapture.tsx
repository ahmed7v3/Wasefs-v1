"use client";

import {
  arabCountry,
  earlyJoinResponseSchema,
  toEarlyE164,
} from "@wasfa/shared/schemas/early-access";
import { Check, ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { early } from "../../content/early";
import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { clientContext, elapsedSinceStart, pingPhoneFocus } from "../../lib/early-tracking";
import { Turnstile, useTurnstile } from "../turnstile";

import { filterCountries, orderCountries } from "./countries";
import { useEarlyJoin } from "./EarlyJoinProvider";
import { Flag } from "./flags";

import type { FormEvent, KeyboardEvent } from "react";

const copy = early.phone;

export interface PhoneCaptureProps {
  /** ISO code from `CF-IPCountry`, read by the page on the server; null when unknown. */
  detectedCountry: string | null;
  /** CSP nonce for the Turnstile script. */
  nonce?: string | undefined;
  /** Anchor id of the bar (the header button scrolls to `#join`). */
  id?: string;
}

/**
 * The main element of the page: [flag + dial code | number | "book my place"]. The country picker is
 * an accessible listbox searchable by Arabic/English name or dial code. A successful submit opens
 * the step-2 sheet (`EarlyJoinProvider`); the phone is already saved by then.
 */
export function PhoneCapture({ detectedCountry, nonce, id }: PhoneCaptureProps) {
  const { join, details, joined, openSheet } = useEarlyJoin();
  const ts = useTurnstile();
  const ordered = useMemo(() => orderCountries(detectedCountry), [detectedCountry]);
  const [iso, setIso] = useState(ordered[0]?.iso ?? "EG");
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [armed, setArmed] = useState(false);
  const [exists, setExists] = useState(false);
  const [showError, setShowError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const uid = useId();
  const inputId = `${uid}-phone`;
  const listId = `${uid}-list`;
  const errorId = `${uid}-err`;
  const wrapRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);

  const country = arabCountry(iso) ?? ordered[0];
  const e164 = toEarlyE164(iso, value);
  const hasDigits = /\d/.test(value);
  const visible = useMemo(() => filterCountries(ordered, query), [ordered, query]);

  // Turnstile loads a script + iframe: do it once the page is idle, never while a keyboard animates.
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(
        () => {
          setArmed(true);
        },
        { timeout: 2500 },
      );
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(() => {
      setArmed(true);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // On touch the keyboard would cover the short list; the trigger keeps focus there.
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function closeList() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function choose(nextIso: string) {
    setIso(nextIso);
    setExists(false);
    setQuery("");
    setOpen(false);
    setShowError(false);
    document.getElementById(inputId)?.focus();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = visible[active];
      if (pick) choose(pick.iso);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeList();
    }
  }

  async function run(token: string | undefined) {
    if (!e164) return;
    setBusy(true);
    setServerError(null);
    setExists(false);
    try {
      const result = await api("/public/early-access/join", {
        method: "POST",
        body: { ...clientContext(), country: iso, phone: e164, elapsedMs: elapsedSinceStart() },
        turnstileToken: token,
        schema: earlyJoinResponseSchema,
      });
      joined(result);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "CONFLICT") {
        setExists(true);
        return;
      }
      setServerError(error instanceof ApiRequestError ? error.message : copy.failed);
    } finally {
      ts.reset();
      setBusy(false);
      setWaiting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!e164) {
      setShowError(true);
      document.getElementById(inputId)?.focus();
      return;
    }
    if (ts.enabled && ts.token === null) {
      // The widget runs in the background; the submit continues the moment its token arrives.
      pending.current = true;
      setWaiting(true);
      return;
    }
    void run(ts.token ?? undefined);
  }

  const widgetProps = {
    ...ts.widgetProps,
    onToken: (token: string | null) => {
      ts.widgetProps.onToken(token);
      if (token && pending.current) {
        pending.current = false;
        void run(token);
      }
    },
  };

  if (join) {
    return (
      <div
        id={id}
        className="rounded-[26px] bg-white p-5 shadow-[0_1px_2px_rgb(11_18_32/0.05),0_18px_44px_-14px_rgb(30_58_138/0.25)] ring-1 ring-[#0b1220]/5"
      >
        <p className="flex items-center gap-2 font-heading text-lg font-bold text-[#0b1220]">
          <span className="grid size-7 place-items-center rounded-full bg-[#dcfce7] text-[#15803d]">
            <Check className="size-4" aria-hidden="true" strokeWidth={3} />
          </span>
          {details
            ? copy.doneTitle(`#${details.position.toLocaleString("en-US")}`)
            : copy.joinedTitle}
        </p>
        <p className="mt-1 text-[15px] text-[#4a5670]">
          {details ? copy.doneBody : copy.joinedBody}
        </p>
        <button
          type="button"
          onClick={openSheet}
          className="mt-4 inline-flex min-h-12 items-center rounded-2xl bg-[#1e3a8a] px-6 font-semibold text-white transition-colors hover:bg-[#172e6e] focus-visible:outline-none focus-visible:shadow-focus"
        >
          {details ? copy.doneAction : copy.joinedAction}
        </button>
      </div>
    );
  }

  const invalid = showError && !e164;

  return (
    <form
      id={id}
      ref={wrapRef}
      onSubmit={onSubmit}
      noValidate
      aria-label={copy.label}
      className="relative"
    >
      <div className="rounded-[28px] bg-white p-2 shadow-[0_1px_2px_rgb(11_18_32/0.05),0_22px_48px_-16px_rgb(30_58_138/0.28)] ring-1 ring-[#0b1220]/5 sm:flex sm:items-center sm:gap-2">
        <div
          className={`flex min-w-0 flex-1 items-center rounded-[22px] bg-[#f6f6f4] ps-1 pe-3 ring-1 transition-shadow focus-within:bg-white focus-within:ring-2 focus-within:ring-[#2563eb] ${
            invalid ? "ring-[#b91c1c]" : "ring-transparent"
          }`}
        >
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={country ? copy.countryButton(country.nameAr, country.dial) : copy.listLabel}
            onClick={() => {
              setOpen((o) => !o);
              setActive(0);
            }}
            className="flex min-h-12 shrink-0 items-center gap-2 rounded-[18px] px-3 text-[#0b1220] transition-colors hover:bg-[#0b1220]/5 focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Flag iso={iso} />
            <span dir="ltr" className="text-[15px] font-semibold tabular-nums">
              +{country?.dial}
            </span>
            <ChevronDown
              className={`size-4 text-[#64708a] transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-[#0b1220]/10" />
          <label htmlFor={inputId} className="sr-only">
            {copy.label}
          </label>
          <input
            id={inputId}
            name="tel-national"
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel-national"
            placeholder={copy.placeholder}
            value={value}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            onFocus={() => {
              setTouched(true);
              pingPhoneFocus();
            }}
            onChange={(event) => {
              setValue(event.target.value);
              setServerError(null);
              setExists(false);
              if (showError && toEarlyE164(iso, event.target.value)) setShowError(false);
            }}
            onBlur={() => {
              if (hasDigits) setShowError(true);
            }}
            className="min-h-12 min-w-0 flex-1 bg-transparent px-2 text-start text-lg font-medium tabular-nums text-[#0b1220] placeholder:text-[#8792a8] focus:outline-none"
          />
          {e164 ? (
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#dcfce7] text-[#15803d]">
              <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
              <span className="sr-only">{copy.valid}</span>
            </span>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={busy || waiting || exists}
          className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-[22px] bg-[#1e3a8a] px-7 text-base font-bold text-white shadow-[0_8px_20px_-8px_rgb(30_58_138/0.7)] transition-[background-color,transform] hover:bg-[#172e6e] active:scale-[0.98] focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-70 sm:mt-0 sm:w-auto sm:shrink-0"
        >
          {busy ? copy.submitting : waiting ? copy.verifying : copy.submit}
        </button>
      </div>

      {open ? (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-3xl bg-white shadow-[0_2px_4px_rgb(11_18_32/0.06),0_24px_56px_-12px_rgb(11_18_32/0.28)] ring-1 ring-[#0b1220]/8 sm:inset-x-auto sm:start-0 sm:w-[22rem]">
          <div className="flex items-center gap-2 border-b border-[#0b1220]/8 px-4">
            <Search className="size-4 shrink-0 text-[#64708a]" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                visible[active] ? `${uid}-o-${visible[active].iso}` : undefined
              }
              aria-label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
              className="min-h-12 w-full bg-transparent text-base text-[#0b1220] placeholder:text-[#8792a8] focus:outline-none"
            />
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={copy.listLabel}
            className="max-h-[min(16rem,45svh)] overflow-y-auto overscroll-contain p-1.5"
          >
            {visible.length === 0 ? (
              <li className="px-3 py-4 text-center text-sm text-[#4a5670]">{copy.noResults}</li>
            ) : (
              visible.map((c, index) => (
                <li
                  key={c.iso}
                  id={`${uid}-o-${c.iso}`}
                  role="option"
                  aria-selected={c.iso === iso}
                  onPointerDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    choose(c.iso);
                  }}
                  onMouseMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] ${
                    index === active ? "bg-[#e3eafb]" : ""
                  }`}
                >
                  <Flag iso={c.iso} />
                  <span className="flex-1 truncate text-[#0b1220]">{c.nameAr}</span>
                  <span dir="ltr" className="text-sm tabular-nums text-[#4a5670]">
                    +{c.dial}
                  </span>
                  {c.iso === iso ? (
                    <Check className="size-4 text-[#1e3a8a]" aria-hidden="true" />
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}

      <div aria-live="polite" className="min-h-6 px-3 pt-2 text-sm">
        {exists ? (
          <p role="status" className="font-semibold text-[#1e3a8a]">
            {copy.exists}
          </p>
        ) : invalid ? (
          <p id={errorId} role="alert" className="text-[#b91c1c]">
            {copy.invalid}
          </p>
        ) : serverError ? (
          <p role="alert" className="text-[#b91c1c]">
            {serverError}
          </p>
        ) : (
          <p className="text-[#4a5670]">
            {copy.privacyHint}{" "}
            <Link
              href="/early/privacy"
              className="font-semibold text-[#1e3a8a] underline-offset-4 hover:underline"
            >
              {copy.privacyLink}
            </Link>
          </p>
        )}
      </div>

      {armed || touched ? <Turnstile nonce={nonce} {...widgetProps} className="px-3" /> : null}
    </form>
  );
}
