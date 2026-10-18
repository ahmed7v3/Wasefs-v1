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

/** The switch for WhatsApp notifications on the verified number (STOP on WhatsApp does the same). */
export function WhatsappNotifications() {
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
  if (!prefs?.whatsapp.available) return null;

  const change = async (whatsapp: boolean): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      setPrefs(
        await api("/me/notification-prefs", {
          method: "PUT",
          body: { whatsapp },
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
    <div className="flex flex-col gap-2">
      <Checkbox
        role="switch"
        name="whatsapp-notifications"
        label={t("account.notifications.whatsappLabel")}
        checked={prefs.whatsapp.enabled}
        disabled={busy}
        onChange={(event) => {
          void change(event.target.checked);
        }}
      />
      <p className="text-sm text-text-muted">
        {t(
          prefs.whatsapp.active
            ? "account.notifications.whatsappHint"
            : "account.notifications.whatsappInactive",
        )}
      </p>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
    </div>
  );
}
