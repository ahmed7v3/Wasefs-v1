"use client";

import { t } from "@wasfa/shared/i18n";
import { startPhoneVerificationSchema } from "@wasfa/shared/schemas/phone";
import { Button, Field, Spinner, buttonStyles } from "@wasfa/ui";
import { MessageCircle, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../lib/api-client";
import { errorReason } from "../lib/api-error";
import { useApiForm } from "../lib/forms";
import {
  initialPhase,
  pollPhase,
  startResponseSchema,
  statusResponseSchema,
  unavailableFromReason,
  type Phase,
  type UnavailableReason,
} from "../lib/phone-verification";

import { ErrorNotice } from "./error-notice";
import { PhoneInput } from "./forms/phone-input";
import { Notice } from "./notice";
import { Turnstile, useTurnstile } from "./turnstile";

const POLL_INTERVAL_MS = 2_000;

const UNAVAILABLE_MESSAGES = {
  disabled: "phone.unavailable.disabled",
  not_configured: "phone.unavailable.notConfigured",
  bridge_down: "phone.unavailable.bridgeDown",
} as const;

export interface PhoneVerificationProps {
  /** CSP nonce for the Turnstile script (a server component passes it down). */
  nonce?: string | undefined;
  /** Called once when the number is verified, including when it already was. */
  onVerified: () => void;
  /** Called when the feature is off, so the parent can offer to skip the step. */
  onUnavailable?: (() => void) | undefined;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** QR of the wa.me link as a data URL (`img-src` allows `data:`), built in the browser only. */
function useQrCode(link: string | undefined): string | undefined {
  const [source, setSource] = useState<{ link: string; url: string } | null>(null);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    void import("qrcode")
      .then((qr) => qr.toString(link, { type: "svg", margin: 1, width: 208 }))
      .then((svg) => {
        if (!cancelled) {
          setSource({ link, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
        }
      })
      .catch(() => {
        // No QR is fine: the button and the code are the primary path.
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  return source !== null && source.link === link ? source.url : undefined;
}

function StartForm({
  nonce,
  onStarted,
  onUnavailable,
}: {
  nonce: string | undefined;
  onStarted: (phase: Phase) => void;
  onUnavailable: (reason: UnavailableReason | undefined) => void;
}) {
  const ts = useTurnstile();
  const form = useApiForm({
    schema: startPhoneVerificationSchema,
    initial: { phoneNumber: "" },
    submit: async (values) => {
      try {
        const result = await api("/phone/verify/start", {
          method: "POST",
          body: { phoneNumber: values.phoneNumber },
          schema: startResponseSchema,
          turnstileToken: ts.requireToken(),
        });
        if (result.status === "verified") {
          onStarted({ kind: "verified", phone: values.phoneNumber });
          return;
        }
        const expiresAt = result.expiresAt ? Date.parse(result.expiresAt) : Number.NaN;
        if (Number.isNaN(expiresAt)) {
          onStarted({ kind: "expired" });
          return;
        }
        onStarted({
          kind: "waiting",
          details: {
            code: result.code,
            waLink: result.waLink,
            waNumber: result.waNumber,
            phone: values.phoneNumber,
            expiresAt,
          },
        });
      } catch (error) {
        const off = unavailableFromReason(errorReason(error));
        if (off !== null) {
          onUnavailable(off === "unknown" ? undefined : off);
          return;
        }
        throw error;
      } finally {
        ts.reset();
      }
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5">
      <p className="text-base text-text-muted">{t("phone.verify.intro")}</p>
      <Field
        label={t("phone.verify.numberLabel")}
        hint={t("phone.verify.numberHint")}
        required
        error={form.errors["phoneNumber"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PhoneInput
            {...control}
            name="phoneNumber"
            onChange={(value) => {
              form.setValue("phoneNumber", value);
            }}
            onBlur={() => {
              form.blur("phoneNumber");
            }}
          />
        )}
      </Field>
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="start-verification" loading={form.submitting}>
        {t("phone.verify.start")}
      </Button>
    </form>
  );
}

/** The proof is the sender of the message, so the notice names the number it must come from. */
function SameNumberNotice({ phone }: { phone: string }) {
  const marker = "\u0001";
  const [before = "", after = ""] = t("phone.sameNumber", { phone: marker }).split(marker);
  return (
    <Notice tone="warning" className="font-semibold">
      <p>
        {before}
        <bdi dir="ltr">{phone}</bdi>
        {after}
      </p>
    </Notice>
  );
}

function Waiting({
  details,
  onRestart,
}: {
  details: Extract<Phase, { kind: "waiting" }>["details"];
  onRestart: () => void;
}) {
  const qr = useQrCode(details.waLink);
  return (
    <div className="flex flex-col gap-5">
      {details.phone ? <SameNumberNotice phone={details.phone} /> : null}
      {details.waLink && details.code ? (
        <>
          <p className="text-base text-text">{t("phone.waiting.instructions")}</p>
          <a
            href={details.waLink}
            target="_blank"
            rel="noopener"
            className={buttonStyles({ size: "lg", className: "w-full" })}
          >
            <MessageCircle aria-hidden className="size-5" />
            {t("phone.waiting.openWhatsapp")}
          </a>
          <div className="flex flex-col items-center gap-1 rounded-md bg-primary-soft p-4 text-center">
            <p className="text-sm text-text-muted">{t("phone.waiting.codeLabel")}</p>
            <p dir="ltr" className="font-heading text-3xl font-bold tracking-widest text-primary">
              {details.code}
            </p>
            {details.waNumber ? (
              <p className="text-sm text-text-muted">
                {t("phone.waiting.toNumber")} <bdi dir="ltr">{details.waNumber}</bdi>
              </p>
            ) : null}
          </div>
          {qr ? (
            <div className="hidden flex-col items-center gap-2 md:flex">
              {/* A data: URL image: next/image has nothing to optimise here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={t("phone.waiting.qrAlt")} width={208} height={208} />
              <p className="text-sm text-text-muted">{t("phone.waiting.qrCaption")}</p>
            </div>
          ) : null}
        </>
      ) : (
        <Notice>{t("phone.waiting.resumed")}</Notice>
      )}
      <div role="status" className="flex items-center gap-3 text-base text-text-muted">
        <Spinner decorative />
        {t("phone.waiting.status")}
      </div>
      <Button type="button" variant="ghost" name="change-number" onClick={onRestart}>
        {t("phone.waiting.restart")}
      </Button>
    </div>
  );
}

/**
 * Phone verification by sending a code from the user's own WhatsApp (SECURITY.md §8). Used by
 * onboarding and the account page; the parent decides what to do on `onVerified` and when the
 * feature is unavailable (it is never a dead end: sign-up and email verification still work).
 */
export function PhoneVerification({ nonce, onVerified, onUnavailable }: PhoneVerificationProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [loadError, setLoadError] = useState<unknown>(null);
  const reported = useRef({ verified: false, unavailable: false });
  const latest = useRef({ onVerified, onUnavailable });

  useEffect(() => {
    latest.current = { onVerified, onUnavailable };
  }, [onVerified, onUnavailable]);

  const check = useCallback((signal: AbortSignal) => {
    setLoadError(null);
    api("/phone/verify/status", { schema: statusResponseSchema, signal })
      .then((status) => {
        setPhase(initialPhase(status, Date.now()));
      })
      .catch((error: unknown) => {
        if (!isAbort(error)) setLoadError(error);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    check(controller.signal);
    return () => {
      controller.abort();
    };
  }, [check]);

  // Poll every 2 s while waiting; stops on unmount, on any answer that ends the wait, and at the TTL.
  const waitingUntil = phase.kind === "waiting" ? phase.details.expiresAt : null;
  useEffect(() => {
    if (waitingUntil === null) return;
    const controller = new AbortController();
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      if (Date.now() >= waitingUntil) {
        setPhase({ kind: "expired" });
        return;
      }
      busy = true;
      api("/phone/verify/status", { schema: statusResponseSchema, signal: controller.signal })
        .then((status) => {
          const next = pollPhase(status, waitingUntil, Date.now());
          if (next) setPhase(next);
        })
        .catch(() => {
          // A missed poll is not a failure; the next one tries again.
        })
        .finally(() => {
          busy = false;
        });
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [waitingUntil]);

  useEffect(() => {
    if (phase.kind === "verified" && !reported.current.verified) {
      reported.current.verified = true;
      latest.current.onVerified();
    }
    if (phase.kind === "unavailable" && !reported.current.unavailable) {
      reported.current.unavailable = true;
      latest.current.onUnavailable?.();
    }
  }, [phase]);

  if (loadError) {
    return (
      <ErrorNotice
        error={loadError}
        onRetry={() => {
          setPhase({ kind: "checking" });
          check(new AbortController().signal);
        }}
      />
    );
  }

  switch (phase.kind) {
    case "checking":
      return (
        <div role="status" className="flex items-center gap-3 text-text-muted">
          <Spinner decorative />
          {t("ui.loading")}
        </div>
      );
    case "unavailable":
      return (
        <Notice>
          <p className="font-semibold">{t("phone.unavailable.title")}</p>
          <p>
            {t(phase.reason ? UNAVAILABLE_MESSAGES[phase.reason] : "phone.unavailable.generic")}
          </p>
        </Notice>
      );
    case "form":
      return (
        <StartForm
          nonce={nonce}
          onStarted={setPhase}
          onUnavailable={(reason) => {
            setPhase({ kind: "unavailable", reason });
          }}
        />
      );
    case "waiting":
      return (
        <Waiting
          details={phase.details}
          onRestart={() => {
            setPhase({ kind: "form" });
          }}
        />
      );
    case "verified":
      return (
        <Notice tone="success">
          <p className="font-semibold">{t("phone.verified.title")}</p>
          {phase.phone ? (
            <p>
              <bdi dir="ltr">{phase.phone}</bdi>
            </p>
          ) : null}
        </Notice>
      );
    case "failed":
    case "expired":
      return (
        <div className="flex flex-col gap-4" role="alert">
          <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-4">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
            <p className="text-base text-text">
              {phase.kind === "expired"
                ? t("phone.expired.body")
                : phase.reason === "phone_in_use"
                  ? t("phone.failed.phoneInUse")
                  : t("phone.failed.generic")}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            name="retry-verification"
            onClick={() => {
              setPhase({ kind: "form" });
            }}
          >
            {t("common.retry")}
          </Button>
        </div>
      );
  }
}
