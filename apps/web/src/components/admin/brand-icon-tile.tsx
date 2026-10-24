"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  putBrandingAssetResponseSchema,
  type BrandingAsset,
  type BrandingAssetKey,
} from "@wasfa/shared/schemas/branding";
import { Button, useToast } from "@wasfa/ui";
import { ImageUp, Undo2 } from "lucide-react";
import { useRef, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { checkAssetFile, acceptAttribute, readAsDataUrl } from "../../lib/brand-assets";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";

export interface BrandIconTileProps {
  assetKey: BrandingAssetKey;
  /** What is stored for the key, or undefined while the default shows. */
  asset: BrandingAsset | undefined;
  /** Archived versions that `revert` can bring back. */
  history: number;
  canWrite: boolean;
  /** Called after an override or a revert, so the list reloads. */
  onChanged: () => void;
}

/**
 * One brand image of the icon set: what is live, its size, a picker to replace it by hand and a
 * button to bring the previous version back. A hand-made replacement survives the next symbol
 * upload (the worker only replaces icons older than the symbol).
 */
export function BrandIconTile({
  assetKey,
  asset,
  history,
  canWrite,
  onChanged,
}: BrandIconTileProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const name = t(`admin.branding.icon.${assetKey}` as MessageKey);

  const run = async (action: () => Promise<unknown>, done: MessageKey) => {
    setBusy(true);
    setError(null);
    try {
      await reauth.run(action);
      toast({ tone: "success", title: t(done, { name }) });
      onChanged();
    } catch (failure: unknown) {
      setError(toApiError(failure));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const checked = checkAssetFile(assetKey, file);
    if (!checked.ok) {
      setFileError(
        t(checked.reason === "size" ? "admin.branding.error.size" : "admin.branding.error.type"),
      );
      return;
    }
    setFileError(null);
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file, checked.type);
    } catch {
      setFileError(t("admin.branding.error.read"));
      return;
    }
    if (input.current) input.current.value = "";
    await run(
      () =>
        api(`/admin/branding/assets/${assetKey}`, {
          method: "PUT",
          body: { dataUrl },
          schema: putBrandingAssetResponseSchema,
        }),
      "admin.branding.icon.replaced",
    );
  };

  return (
    <li
      aria-label={name}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3"
    >
      <div className="flex items-center gap-3">
        <div className="grid size-16 shrink-0 place-items-center rounded-md border border-border bg-bg">
          {asset ? (
            <img
              src={asset.url}
              alt={t("admin.branding.icon.alt", { name })}
              className="max-h-14 max-w-14 object-contain"
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-base font-semibold text-text">
            <bdi>{name}</bdi>
          </p>
          <p className="text-sm text-text-muted tabular-nums">
            {asset
              ? t("admin.branding.icon.meta", {
                  width: asset.width === null ? "?" : formatNumber(asset.width),
                  height: asset.height === null ? "?" : formatNumber(asset.height),
                  size: formatNumber(Math.max(1, Math.round(asset.size / 1024))),
                })
              : t("admin.branding.icon.missing")}
          </p>
        </div>
      </div>
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={acceptAttribute(assetKey)}
            aria-label={t("admin.branding.icon.overrideLabel", { name })}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              void choose(event.target.files?.[0]);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            name={`override-${assetKey}`}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImageUp aria-hidden className="size-5" />
            {t("admin.branding.icon.override")}
          </Button>
          {history > 0 ? (
            <Button
              type="button"
              variant="ghost"
              name={`revert-${assetKey}`}
              aria-label={t("admin.branding.icon.revertLabel", { name })}
              disabled={busy}
              onClick={() => {
                void run(
                  () =>
                    api(`/admin/branding/assets/${assetKey}/revert`, { method: "POST", body: {} }),
                  "admin.branding.icon.reverted",
                );
              }}
            >
              <Undo2 aria-hidden className="size-5" />
              {t("admin.branding.icon.revert")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {fileError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {fileError}
        </p>
      ) : null}
      {error ? <ErrorNotice error={error} supportHref={null} /> : null}
    </li>
  );
}
