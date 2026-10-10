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
}

/** Social sign-in buttons, driven by the provider registry (DESIGN-SYSTEM §5.3). Renders nothing without any. */
export function SocialButtons({ providers, next }: SocialButtonsProps) {
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-sm text-text-muted" role="separator">
        <span className="h-px flex-1 bg-border" />
        {t("auth.social.or")}
        <span className="h-px flex-1 bg-border" />
      </div>
      {visible.map(({ id, status }) => {
        const { label, Icon } = PROVIDERS[id];
        const soon = status === "coming_soon";
        return (
          <Button
            key={id}
            variant="secondary"
            name={`social-${id}`}
            loading={busy === id}
            disabled={soon || busy !== null}
            onClick={() => {
              void start(id);
            }}
            className="justify-between"
          >
            <span className="inline-flex items-center gap-3">
              <Icon className="size-5" />
              {t(label)}
            </span>
            {soon ? <ComingSoonBadge /> : null}
          </Button>
        );
      })}
      {error ? <ErrorNotice error={error} /> : null}
    </div>
  );
}
