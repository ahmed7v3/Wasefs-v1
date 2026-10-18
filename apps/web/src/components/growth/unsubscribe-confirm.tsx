"use client";

import { t } from "@wasfa/shared/i18n";
import { Button } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

/**
 * One button: a GET must never unsubscribe (mail scanners open links), so the footer link lands
 * here and the click sends the signed token. Mail clients use the one-click header instead.
 */
export function UnsubscribeConfirm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid">("idle");
  const [failure, setFailure] = useState<unknown>(null);

  if (state === "done") {
    return (
      <Notice tone="success">
        <span className="flex flex-col gap-1">
          <strong>{t("growth.unsubscribe.title")}</strong>
          <span>{t("growth.unsubscribe.body")}</span>
        </span>
      </Notice>
    );
  }
  if (state === "invalid") return <Notice tone="warning">{t("growth.unsubscribe.invalid")}</Notice>;

  return (
    <div className="flex flex-col gap-4">
      <Button
        name="confirm-unsubscribe"
        loading={state === "busy"}
        className="self-start"
        onClick={() => {
          setState("busy");
          setFailure(null);
          api("/unsubscribe", { method: "POST", body: { token } }).then(
            () => {
              setState("done");
            },
            (error: unknown) => {
              if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
                setState("invalid");
                return;
              }
              setFailure(error);
              setState("idle");
            },
          );
        }}
      >
        {t("growth.unsubscribe.confirm")}
      </Button>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
    </div>
  );
}
