"use client";

import { t } from "@wasfa/shared/i18n/public";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError } from "../lib/api-error";
import { publicEnv } from "../lib/env";

/*
 * Cloudflare Turnstile, explicit rendering. Without a site key nothing is rendered and no token is
 * sent: the API then runs without Turnstile as well (it only checks when it has a secret).
 */

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      language: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page. The CSP nonce lets `strict-dynamic` trust it. */
function loadTurnstile(nonce: string | undefined): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    if (nonce) script.nonce = nonce;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile missing"));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.append(script);
  });
  return loading;
}

export interface TurnstileProps {
  /** CSP nonce; a server component reads it from the `x-nonce` request header and passes it down. */
  nonce?: string | undefined;
  onToken: (token: string | null) => void;
  /** Change this number to reset the widget (the token is single use). */
  resetSignal?: number;
  className?: string | undefined;
}

export function Turnstile({ nonce, onToken, resetSignal = 0, className }: TurnstileProps) {
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const latestOnToken = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latestOnToken.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadTurnstile(nonce)
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          language: "ar",
          callback: (token) => {
            latestOnToken.current(token);
          },
          "expired-callback": () => {
            latestOnToken.current(null);
          },
          "error-callback": () => {
            latestOnToken.current(null);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId.current !== null) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, nonce]);

  useEffect(() => {
    if (resetSignal === 0 || widgetId.current === null) return;
    window.turnstile?.reset(widgetId.current);
  }, [resetSignal]);

  if (!siteKey) return null;
  return (
    <div className={className}>
      {/* Reserved height: the widget appears late and must not push the form around. */}
      <div ref={container} className="min-h-[65px]" />
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          {t("auth.turnstileLoadFailed")}
        </p>
      ) : null}
    </div>
  );
}

export interface TurnstileState {
  /** A site key is configured: forms must have a token before they submit. */
  enabled: boolean;
  token: string | null;
  /** Spread onto `<Turnstile>`. */
  widgetProps: { onToken: (token: string | null) => void; resetSignal: number };
  /** Call after every submit: a token works once. */
  reset: () => void;
  /** The token to send, or a `turnstile_required` error when the check is on but not solved yet. */
  requireToken: () => string | undefined;
}

export function useTurnstile(): TurnstileState {
  const enabled = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY !== undefined;
  const [token, setToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const reset = useCallback(() => {
    setToken(null);
    setResetSignal((signal) => signal + 1);
  }, []);

  const requireToken = (): string | undefined => {
    if (enabled && token === null) {
      throw new ApiRequestError("VALIDATION_FAILED", t("auth.turnstileRequired"), undefined, 0, {
        reason: "turnstile_required",
      });
    }
    return token ?? undefined;
  };

  return {
    enabled,
    token,
    widgetProps: { onToken: setToken, resetSignal },
    reset,
    requireToken,
  };
}
