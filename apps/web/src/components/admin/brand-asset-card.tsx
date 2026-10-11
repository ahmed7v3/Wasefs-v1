"use client";

import { t } from "@wasfa/shared/i18n";
import { brandingAssetSchema } from "@wasfa/shared/schemas/branding";
import { Button, Card, CardTitle, useToast } from "@wasfa/ui";
import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../lib/api-client";
import {
  acceptAttribute,
  checkAssetFile,
  readAsDataUrl,
  type EditableAssetKey,
} from "../../lib/brand-assets";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";

import type { ApiRequestError } from "../../lib/api-error";

export interface BrandAssetCardProps {
  assetKey: EditableAssetKey;
  /** Public URL of the stored image, or `null` while nothing is uploaded. */
  url: string | null;
  canWrite: boolean;
  /** Called after an upload or a delete, so the page reloads the settings. */
  onChanged: () => void;
}

interface Picked {
  name: string;
  /** `data:<type>;base64,...`, also what the preview draws and what the upload sends. */
  dataUrl: string;
}

/**
 * One brand image: what is live now, a file picker with a preview of the chosen file, upload and
 * delete. The file is checked in the browser (type, 512 KB) to save a round trip; the api checks the
 * bytes again and is the authority. Writes go through `useReauth().run` (fresh login, 10 minutes).
 */
export function BrandAssetCard({ assetKey, url, canWrite, onChanged }: BrandAssetCardProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<ApiRequestError | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const title = t(`admin.branding.${assetKey}.title`);

  const choose = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    const checked = checkAssetFile(assetKey, file);
    if (!checked.ok) {
      setPicked(null);
      setFileError(
        t(checked.reason === "size" ? "admin.branding.error.size" : "admin.branding.error.type"),
      );
      return;
    }
    try {
      setPicked({ name: file.name, dataUrl: await readAsDataUrl(file, checked.type) });
      setFileError(null);
    } catch {
      setPicked(null);
      setFileError(t("admin.branding.error.read"));
    }
  };

  const upload = () => {
    if (!picked || uploading) return;
    setUploading(true);
    setUploadError(null);
    reauth
      .run(() =>
        api(`/admin/branding/assets/${assetKey}`, {
          method: "PUT",
          body: { dataUrl: picked.dataUrl },
          schema: brandingAssetSchema,
        }),
      )
      .then(
        () => {
          setUploading(false);
          setPicked(null);
          if (input.current) input.current.value = "";
          toast({ tone: "success", title: t("admin.branding.uploaded", { name: title }) });
          onChanged();
        },
        (error: unknown) => {
          setUploading(false);
          setUploadError(toApiError(error));
        },
      );
  };

  const remove = async (): Promise<void> => {
    await api(`/admin/branding/assets/${assetKey}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.branding.deleted", { name: title }) });
    onChanged();
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-text-muted">{t(`admin.branding.${assetKey}.description`)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-label={t("admin.branding.current")} className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-text">{t("admin.branding.current")}</h3>
          <div className="grid min-h-24 place-items-center rounded-md border border-border bg-bg p-4">
            {url === null ? (
              <p className="text-center text-sm text-text-muted">{t("admin.branding.none")}</p>
            ) : (
              <img
                src={url}
                alt={t("admin.branding.currentAlt", { name: title })}
                className="max-h-24 max-w-full object-contain"
              />
            )}
          </div>
        </section>

        {picked ? (
          <section aria-label={t("admin.branding.pickedAlt")} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-text">
              {t("admin.branding.picked", { name: picked.name })}
            </h3>
            <div className="grid min-h-24 place-items-center rounded-md border border-border bg-bg p-4">
              <img
                src={picked.dataUrl}
                alt={t("admin.branding.pickedAlt")}
                className="max-h-24 max-w-full object-contain"
              />
            </div>
          </section>
        ) : null}
      </div>

      {canWrite ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">{t(`admin.branding.hint.${assetKey}`)}</p>
          <input
            ref={input}
            type="file"
            accept={acceptAttribute(assetKey)}
            aria-label={t("admin.branding.chooseFor", { name: title })}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              void choose(event.target.files?.[0]);
            }}
          />
          {fileError ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {fileError}
            </p>
          ) : null}
          {uploadError ? <ErrorNotice error={uploadError} supportHref={null} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              name="choose"
              onClick={() => input.current?.click()}
            >
              <ImageUp aria-hidden className="size-5" />
              {t("admin.branding.choose")}
            </Button>
            <Button
              type="button"
              name="upload"
              disabled={!picked}
              loading={uploading}
              onClick={upload}
            >
              {t("admin.branding.upload")}
            </Button>
            {url !== null ? (
              <Button
                type="button"
                variant="secondary"
                name="delete"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                <Trash2 aria-hidden className="size-5" />
                {t("admin.branding.delete")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("admin.branding.deleteTitle", { name: title })}
        description={t("admin.branding.deleteBody")}
        confirmLabel={t("admin.branding.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </Card>
  );
}
