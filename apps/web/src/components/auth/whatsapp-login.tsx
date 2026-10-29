"use client";

import { t } from "@wasfa/shared/i18n";
import {
  waLoginStartResponseSchema,
  waLoginStatusResponseSchema,
} from "@wasfa/shared/schemas/wa-login";
import { Button, Spinner, cn } from "@wasfa/ui";
import { MessageCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useQrCode } from "../../lib/use-qr-code";
import {
  formatCountdown,
  isMobileDevice,
  nextPhase,
  signedInTarget,
  whatsappWebLink,
  type WhatsAppPhase,
} from "../../lib/whatsapp-login";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";
import { Turnstile, useTurnstile } from "../turnstile";

import type { ApiRequestError } from "../../lib/api-error";

const POLL_INTERVAL_MS = 2_000;

/** WhatsApp's own green, with dark text: white on this green does not reach AA contrast. */
const GREEN_BUTTON =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-7 text-lg " +
  "font-heading font-semibold bg-[#25D366] text-[#052e1a] transition-colors duration-150 " +
  "hover:bg-[#20bd5a] focus-visible:outline-none focus-visible:shadow-focus " +
  "disabled:pointer-events-none disabled:opacity-50";

export interface WhatsAppLoginProps {
  /** From `GET /auth/whatsapp/availability`: the setting is on and a bridge number exists. */
  available: boolean;
  /** Already vetted by `safeNext`. */
  next: string;
  /** CSP nonce for the Turnstile script. */
  nonce?: string | undefined;
  /** Where "sign in with a password" goes; without it the panel simply closes. */
  passwordHref?: string | undefined;
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-sm text-text-muted" role="separator">
      <span className="h-px flex-1 bg-border" />
      {t("auth.social.or")}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Terms() {
  const link = "font-semibold text-primary underline underline-offset-2";
  return (
    <p className="text-sm text-text-muted">
      {t("auth.whatsapp.terms")}{" "}
      <Link href="/terms" target="_blank" rel="noopener" className={link}>
        {t("auth.terms.terms")}
      </Link>{" "}
      {t("auth.terms.and")}{" "}
      <Link href="/privacy" target="_blank" rel="noopener" className={link}>
        {t("auth.terms.privacy")}
      </Link>
    </p>
  );
}

function Waiting({
  phase,
  remainingMs,
  onCancel,
}: {
  phase: Extract<WhatsAppPhase, { kind: "waiting" }>;
  remainingMs: number;
  onCancel: () => void;
}) {
  // Desktop only: on a phone the button opens WhatsApp directly, a QR would point at itself.
  const qr = useQrCode(phase.mobile ? undefined : phase.waLink);
  const web = phase.mobile ? null : whatsappWebLink(phase.waLink);
  return (
    <div className="flex flex-col gap-4">
      {phase.mobile ? (
        <a href={phase.waLink} target="_blank" rel="noopener" className={GREEN_BUTTON}>
          <MessageCircle aria-hidden className="size-5" />
          {t("auth.whatsapp.openWhatsapp")}
        </a>
      ) : (
        <>
          <p className="text-base text-text">{t("auth.whatsapp.scanQr")}</p>
          {qr ? (
            <div className="flex flex-col items-center gap-2">
              {/* A data: URL image: next/image has nothing to optimise here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={t("auth.whatsapp.qrAlt")} width={208} height={208} />
            </div>
          ) : null}
          {web ? (
            <a
              href={web}
              target="_blank"
              rel="noopener"
              className="text-center text-base font-semibold text-primary underline underline-offset-4"
            >
              {t("auth.whatsapp.openWeb")}
            </a>
          ) : null}
        </>
      )}
      <div className="flex flex-col items-center gap-1 rounded-md bg-primary-soft p-4 text-center">
        <p className="text-sm text-text-muted">{t("auth.whatsapp.codeLabel")}</p>
        <p dir="ltr" className="font-heading text-3xl font-bold tracking-widest text-primary">
          {phase.token}
        </p>
      </div>
      <div role="status" className="flex items-center gap-3 text-base text-text-muted">
        <Spinner decorative />
        <span>{t("auth.whatsapp.waiting")}</span>
      </div>
      <p className="text-sm text-text-muted">
        {t("auth.whatsapp.countdown", { time: formatCountdown(remainingMs) })}
      </p>
      <Button type="button" variant="ghost" name="whatsapp-cancel" onClick={onCancel}>
        {t("auth.whatsapp.cancel")}
      </Button>
    </div>
  );
}

/**
 * "Continue with WhatsApp": the account in two taps, the phone proven by WhatsApp itself
 * (docs/WA-SIGNUP.md). Turnstile, then the challenge; the person sends the pre-filled message and this
 * browser (the only one holding the challenge cookie) picks up the session by polling every 2 s.
 */
export function WhatsAppLogin({ available, next, nonce, passwordHref }: WhatsAppLoginProps) {
  const router = useRouter();
  const ts = useTurnstile();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<WhatsAppPhase>({ kind: "idle" });
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped to ask for a fresh challenge (after an error or an expiry).
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  const restart = useCallback(() => {
    started.current = false;
    setError(null);
    setPhase({ kind: "idle" });
    setAttempt((value) => value + 1);
  }, []);

  const close = useCallback(() => {
    started.current = false;
    setOpen(false);
    setPhase({ kind: "idle" });
    setError(null);
  }, []);

  // Open -> Turnstile solved (or not needed) -> one start.
  const startToken = ts.token;
  const tsEnabled = ts.enabled;
  const resetTurnstile = ts.reset;
  useEffect(() => {
    if (!open || started.current) return;
    if (tsEnabled && startToken === null) return;
    started.current = true;
    setPhase({ kind: "starting" });
    api("/auth/whatsapp/start", {
      method: "POST",
      body: {},
      turnstileToken: startToken,
      schema: waLoginStartResponseSchema,
    })
      .then((result) => {
        const expiresAt = Date.parse(result.expiresAt);
        if (!result.waLink.startsWith("https://wa.me/") || Number.isNaN(expiresAt)) {
          setPhase({ kind: "expired" });
          return;
        }
        setNow(Date.now());
        setPhase({
          kind: "waiting",
          token: result.code,
          waLink: result.waLink,
          expiresAt,
          mobile: isMobileDevice(),
        });
      })
      .catch((caught: unknown) => {
        setError(toApiError(caught));
        setPhase({ kind: "idle" });
      })
      .finally(() => {
        resetTurnstile();
      });
  }, [open, attempt, startToken, tsEnabled, resetTurnstile]);

  // Poll every 2 s while the tab is visible; the moment it becomes visible again, poll at once.
  const waiting = phase.kind === "waiting" ? phase : null;
  useEffect(() => {
    if (waiting === null) return;
    const controller = new AbortController();
    let busy = false;
    const poll = () => {
      if (busy || document.hidden) return;
      busy = true;
      api(`/auth/whatsapp/status?token=${encodeURIComponent(waiting.token)}`, {
        schema: waLoginStatusResponseSchema,
        signal: controller.signal,
      })
        .then((answer) => {
          const next_ = nextPhase(waiting, answer, Date.now());
          if (next_ === null) return;
          setPhase(next_);
          if (next_.kind === "signed_in") {
            router.replace(signedInTarget(next, answer.isNew));
            router.refresh();
          }
        })
        .catch(() => {
          // A missed poll (or the abort on unmount) is not a failure; the next tick tries again.
        })
        .finally(() => {
          busy = false;
        });
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      controller.abort();
    };
  }, [waiting, router, next]);

  // The countdown, and the local end of the challenge.
  useEffect(() => {
    if (waiting === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= waiting.expiresAt) setPhase({ kind: "expired" });
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [waiting]);

  if (!available) return null;

  const body = (() => {
    switch (phase.kind) {
      case "idle":
      case "starting":
        return (
          <div className="flex flex-col gap-3">
            {error ? <ErrorNotice error={error} onRetry={restart} /> : null}
            <Turnstile nonce={nonce} {...ts.widgetProps} />
            {error ? null : (
              <div role="status" className="flex items-center gap-3 text-base text-text-muted">
                <Spinner decorative />
                {t("ui.loading")}
              </div>
            )}
            <Button type="button" variant="ghost" name="whatsapp-cancel" onClick={close}>
              {t("auth.whatsapp.cancel")}
            </Button>
          </div>
        );
      case "waiting":
        return <Waiting phase={phase} remainingMs={phase.expiresAt - now} onCancel={close} />;
      case "signed_in":
        return (
          <div role="status" className="flex items-center gap-3 text-base text-text-muted">
            <Spinner decorative />
            {t("ui.loading")}
          </div>
        );
      case "refused":
        return (
          <div className="flex flex-col gap-4" role="alert">
            <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-4">
              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
              <p className="text-base text-text">
                {t(
                  phase.reason
                    ? (`auth.whatsapp.refused.${phase.reason}` as const)
                    : "auth.whatsapp.refused.generic",
                )}
              </p>
            </div>
            {passwordHref ? (
              <Link
                href={passwordHref}
                className="text-center text-base font-semibold text-primary underline underline-offset-4"
              >
                {t("auth.whatsapp.usePassword")}
              </Link>
            ) : (
              <Button type="button" variant="secondary" name="whatsapp-close" onClick={close}>
                {t("auth.whatsapp.usePassword")}
              </Button>
            )}
          </div>
        );
      case "expired":
        return (
          <div className="flex flex-col gap-4" role="alert">
            <Notice tone="warning">
              <p>{t("auth.whatsapp.expired")}</p>
            </Notice>
            <Button type="button" variant="secondary" name="whatsapp-restart" onClick={restart}>
              {t("auth.whatsapp.restart")}
            </Button>
          </div>
        );
    }
  })();

  return (
    <div className={cn("flex flex-col gap-4")}>
      {open ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">{body}</div>
      ) : (
        <>
          <button
            type="button"
            name="whatsapp-login"
            className={GREEN_BUTTON}
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            <MessageCircle aria-hidden className="size-6" />
            {t("auth.whatsapp.button")}
          </button>
          <Terms />
        </>
      )}
      <Divider />
    </div>
  );
}
