"use client";

import { t } from "@wasfa/shared/i18n";
import {
  notificationPrefsResponseSchema,
  type NotificationPrefsResponse,
} from "@wasfa/shared/schemas/notification-prefs";
import { Checkbox, useToast } from "@wasfa/ui";
import { useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { ErrorNotice } from "../error-notice";

/**
 * Tips and offers by email (GROWTH §6): off unless the person ticks it, on or off in one click,
 * the same switch the one-click unsubscribe link turns off. Account and payment mail is not affected.
 */
export function MarketingEmails() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    api("/me/notification-prefs", { schema: notificationPrefsResponseSchema })
      .then((value) => {
        if (alive) setPrefs(value);
      })
      .catch((error: unknown) => {
        if (alive) setFailure(error);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failure && !prefs) return <ErrorNotice error={failure} supportHref={null} />;
  if (!prefs) return null;

  const change = async (marketing: boolean): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      setPrefs(
        await api("/me/notification-prefs", {
          method: "PUT",
          body: { marketing },
          schema: notificationPrefsResponseSchema,
        }),
      );
      toast({ tone: "success", title: t("account.notifications.saved") });
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="marketing-title" className="flex flex-col gap-2">
      <h2 id="marketing-title" className="font-heading text-2xl font-semibold text-text">
        {t("growth.consent.accountLabel")}
      </h2>
      <Checkbox
        role="switch"
        name="marketing-emails"
        label={t("growth.consent.label")}
        checked={prefs.marketing.enabled}
        disabled={busy}
        onChange={(event) => {
          void change(event.target.checked);
        }}
      />
      <p className="text-sm text-text-muted">{t("growth.consent.accountHint")}</p>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
    </section>
  );
}
