"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, ComingSoonBadge } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { siteUrl, socialSignInResponseSchema, type ProviderStates } from "../../lib/auth-api";
import { toApiError } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

import { FacebookMark, GoogleMark } from "./provider-icons";

import type { ApiRequestError } from "../../lib/api-error";

const PROVIDERS = {
  google: { label: "auth.social.google", Icon: GoogleMark },
  facebook: { label: "auth.social.facebook", Icon: FacebookMark },
} as const;

export interface SocialButtonsProps {
  /** From `GET /auth/providers`; `disabled` providers are not drawn at all. */
  providers: ProviderStates;
  /** Already vetted by `safeNext`; the user lands here after the provider sends them back. */
  next: string;
  /**
   * `signup` puts the buttons above the form: Google is the filled primary action, the divider comes
   * after them, and a note says the phone still has to be verified. `signin` is the default below-form list.
   */
  mode?: "signin" | "signup";
}

/** Social sign-in buttons, driven by the provider registry (DESIGN-SYSTEM §5.3). Renders nothing without any. */
export function SocialButtons({ providers, next, mode = "signin" }: SocialButtonsProps) {
  const signup = mode === "signup";
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const visible = providers.filter((provider) => provider.status !== "disabled");
  if (visible.length === 0) return null;

  const start = async (provider: "google" | "facebook") => {
    setBusy(provider);
    setError(null);
    try {
      const { url } = await api("/auth/sign-in/social", {
        method: "POST",
        body: { provider, callbackURL: siteUrl(next) },
        schema: socialSignInResponseSchema,
      });
      // The provider's own page: a full navigation, the SPA router cannot go there.
      window.location.assign(url);
    } catch (caught) {
      setError(toApiError(caught));
      setBusy(null);
    }
  };

  // Google first on sign-up, whatever order the registry returned.
  const ordered = signup
    ? [...visible].sort((a, b) => Number(b.id === "google") - Number(a.id === "google"))
    : visible;

  const divider = (
    <div className="flex items-center gap-3 text-sm text-text-muted" role="separator">
      <span className="h-px flex-1 bg-border" />
      {t("auth.social.or")}
      <span className="h-px flex-1 bg-border" />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {signup ? null : divider}
      {ordered.map(({ id, status }) => {
        const { label, Icon } = PROVIDERS[id];
        const soon = status === "coming_soon";
        const primary = signup && id === "google";
        return (
          <Button
            key={id}
            variant={primary ? "primary" : "secondary"}
            size={primary ? "lg" : "md"}
            name={`social-${id}`}
            loading={busy === id}
            disabled={soon || busy !== null}
            onClick={() => {
              void start(id);
            }}
            className="justify-between"
          >
            <span className="inline-flex items-center gap-3">
              {primary ? (
                // The multicolour mark needs a light backing on the filled button.
                <span className="inline-flex rounded-full bg-white p-1">
                  <Icon className="size-5" />
                </span>
              ) : (
                <Icon className="size-5" />
              )}
              {t(primary ? "auth.social.googleSignUp" : label)}
            </span>
            {soon ? <ComingSoonBadge /> : null}
          </Button>
        );
      })}
      {error ? <ErrorNotice error={error} /> : null}
      {signup && ordered.some((p) => p.id === "google") ? (
        <p className="text-sm text-text-muted">{t("auth.social.googleNote")}</p>
      ) : null}
      {signup ? divider : null}
    </div>
  );
}
