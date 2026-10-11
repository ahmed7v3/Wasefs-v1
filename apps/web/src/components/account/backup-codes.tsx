"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Checkbox } from "@wasfa/ui";
import { Copy, Download } from "lucide-react";
import { useState } from "react";

export interface BackupCodesProps {
  codes: readonly string[];
  /** Called when the user confirmed they saved the codes and pressed "done". The parent then drops the codes. */
  onDone: () => void;
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Backup codes, shown exactly once: copy, download as text, and a checkbox that must be ticked
 * before "done" works (the codes cannot be shown again, so closing by accident would lose them).
 */
export function BackupCodes({ codes, onDone }: BackupCodesProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
      },
      () => {
        // Clipboard blocked: the download button and the visible list still work.
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-heading text-xl font-semibold text-text">
        {t("account.twoFactor.backupTitle")}
      </h3>
      <p className="text-base text-text-muted">{t("account.twoFactor.backupLead")}</p>
      <ul
        dir="ltr"
        className="grid grid-cols-2 gap-2 rounded-lg bg-primary-soft p-4 font-mono text-base text-text"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" name="copy-codes" onClick={copy}>
          <Copy aria-hidden className="size-4" />
          {copied ? t("common.copied") : t("account.twoFactor.copy")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          name="download-codes"
          onClick={() => {
            downloadText("wasfa-backup-codes.txt", `${text}\n`);
          }}
        >
          <Download aria-hidden className="size-4" />
          {t("account.twoFactor.download")}
        </Button>
      </div>
      <Checkbox
        name="codes-saved"
        label={t("account.twoFactor.saved")}
        checked={saved}
        onChange={(event) => {
          setSaved(event.target.checked);
        }}
      />
      <div>
        <Button type="button" size="lg" name="finish-codes" disabled={!saved} onClick={onDone}>
          {t("account.twoFactor.finish")}
        </Button>
      </div>
    </div>
  );
}
