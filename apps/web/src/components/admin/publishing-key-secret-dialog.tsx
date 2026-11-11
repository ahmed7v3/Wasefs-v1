"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Dialog } from "@wasfa/ui";
import { TriangleAlert } from "lucide-react";

import { publishingBaseUrl } from "../../lib/publishing-admin";

import { CopyBlock } from "./publishing-copy-block";

import type { PublishingKeyIssued } from "@wasfa/shared/schemas/admin-publishing-keys";

export interface KeySecretDialogProps {
  /** The one-time response of create or rotate; `null` closes the dialog and drops the secret. */
  issued: PublishingKeyIssued | null;
  onClose: () => void;
}

/**
 * The only place the full key is ever shown. The secret lives in the parent's component state and
 * the body below is unmounted when `issued` is null, so closing leaves nothing in the DOM.
 */
export function KeySecretDialog({ issued, onClose }: KeySecretDialogProps) {
  const base = publishingBaseUrl();
  return (
    <Dialog
      open={issued !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("admin.pub.secret.title")}
    >
      {issued ? (
        <div className="flex flex-col gap-4">
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm font-semibold text-warning"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t("admin.pub.secret.warning")}
          </p>
          <CopyBlock label={t("admin.pub.secret.keyLabel")} text={issued.secret} />
          <CopyBlock label={t("admin.pub.secret.endpointLabel")} text={base} />
          <CopyBlock
            multiline
            label={t("admin.pub.secret.messageLabel")}
            hint={t("admin.pub.secret.messageHint")}
            text={t("admin.pub.claudeMessage", { base, key: issued.secret })}
          />
          <div className="flex justify-end">
            <Button type="button" name="saved" onClick={onClose}>
              {t("admin.pub.secret.saved")}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
