"use client";

import { t } from "@wasfa/shared/i18n";
import {
  BRANDING_GENERATED_KEYS,
  brandingAssetListSchema,
  putBrandingAssetResponseSchema,
  type BrandingAsset,
  type BrandingAssetKey,
} from "@wasfa/shared/schemas/branding";
import { Button, Card, CardTitle, Skeleton, useToast } from "@wasfa/ui";
import { ImageUp, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { acceptAttribute, checkAssetFile, readAsDataUrl } from "../../lib/brand-assets";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { BrandIconTile } from "./brand-icon-tile";
import { BrandPreviewPanel } from "./brand-preview-panel";

import type { ApiRequestError } from "../../lib/api-error";

/** How often the asset list is re-read while icons are being rendered, and when to give up. */
export const GENERATION_POLL_MS = 2_000;
export const GENERATION_TIMEOUT_MS = 30_000;

const EXTRA_KEYS = ["og_default", "logo_en", "logo_mono", "email_logo"] as const;

type Status = "idle" | "generating" | "generated" | "timeout";

interface Generation {
  /** The sha256 of every generated key when the symbol was uploaded. */
  baseline: Record<string, string | undefined>;
  startedAt: number;
}

export interface BrandSymbolSectionProps {
  canWrite: boolean;
  logoUrl: string | null;
}

/**
 * «رمز الموقع والأيقونات»: the symbol upload that renders the whole icon set, the generated icons
 * with their own override and revert, and the preview panel. After an upload the list is polled
 * until some generated icon has a new digest (the worker finished) or 30 seconds have passed (an
 * icon the admin uploaded by hand after the symbol is deliberately not replaced, so "nothing
 * changed" can also be the right outcome).
 */
export function BrandSymbolSection({ canWrite, logoUrl }: BrandSymbolSectionProps) {
  const list = useResource("/admin/branding/assets", brandingAssetListSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ name: string; dataUrl: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<ApiRequestError | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const reload = list.reload;
  const data = list.status === "ready" ? list.data : null;

  // Poll while generating.
  useEffect(() => {
    if (generation === null) return;
    const timer = setInterval(reload, GENERATION_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [generation, reload]);

  // Decide after every reload whether the icons changed or time ran out.
  useEffect(() => {
    if (generation === null || data === null) return;
    const changed = BRANDING_GENERATED_KEYS.some(
      (key) => data.items.find((item) => item.key === key)?.sha256 !== generation.baseline[key],
    );
    if (changed) {
      setStatus("generated");
      setGeneration(null);
    } else if (Date.now() - generation.startedAt >= GENERATION_TIMEOUT_MS) {
      setStatus("timeout");
      setGeneration(null);
    }
  }, [data, generation]);

  if (list.status === "loading") {
    return (
      <Card elevation="flat" className="flex flex-col gap-3" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  if (list.status === "error") {
    return <ErrorNotice error={list.error} onRetry={list.reload} />;
  }

  const items = list.data.items;
  const assetOf = (key: BrandingAssetKey): BrandingAsset | undefined =>
    items.find((item) => item.key === key);
  const history = (key: BrandingAssetKey) => list.data.history[key] ?? 0;
  const symbol = assetOf("symbol");

  const choose = async (file: File | undefined) => {
    setUploadError(null);
    if (!file) return;
    const checked = checkAssetFile("symbol", file);
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

  const upload = async () => {
    if (!picked || uploading) return;
    setUploading(true);
    setUploadError(null);
    setWarnings([]);
    const baseline = Object.fromEntries(
      BRANDING_GENERATED_KEYS.map((key) => [key, assetOf(key)?.sha256]),
    );
    try {
      const result = await reauth.run(() =>
        api("/admin/branding/assets/symbol", {
          method: "PUT",
          body: { dataUrl: picked.dataUrl },
          schema: putBrandingAssetResponseSchema,
        }),
      );
      setPicked(null);
      if (input.current) input.current.value = "";
      setWarnings(result.warnings);
      toast({ tone: "success", title: t("admin.branding.symbol.uploaded") });
      setStatus("generating");
      setGeneration({ baseline, startedAt: Date.now() });
      reload();
    } catch (error: unknown) {
      setUploadError(toApiError(error));
    } finally {
      setUploading(false);
    }
  };

  const revertSymbol = async () => {
    setUploadError(null);
    try {
      const baselineSnapshot = Object.fromEntries(
        BRANDING_GENERATED_KEYS.map((key) => [key, assetOf(key)?.sha256]),
      );
      await reauth.run(() =>
        api("/admin/branding/assets/symbol/revert", { method: "POST", body: {} }),
      );
      setStatus("generating");
      setGeneration({ baseline: baselineSnapshot, startedAt: Date.now() });
      reload();
    } catch (error: unknown) {
      setUploadError(toApiError(error));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{t("admin.branding.symbol.title")}</CardTitle>
          <p className="text-sm text-text-muted">{t("admin.branding.symbol.description")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-label={t("admin.branding.symbol.current")} className="flex flex-col gap-2">
            <h3 className="text-base font-semibold text-text">
              {t("admin.branding.symbol.current")}
            </h3>
            <div className="grid min-h-24 place-items-center rounded-md border border-border bg-bg p-4">
              {symbol ? (
                <img
                  src={symbol.url}
                  alt={t("admin.branding.symbol.currentAlt")}
                  className="max-h-24 max-w-full object-contain"
                />
              ) : (
                <p className="text-center text-sm text-text-muted">
                  {t("admin.branding.symbol.none")}
                </p>
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
            <p className="text-sm text-text-muted">{t("admin.branding.symbol.hint")}</p>
            <input
              ref={input}
              type="file"
              accept={acceptAttribute("symbol")}
              aria-label={t("admin.branding.symbol.chooseLabel")}
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
                name="choose-symbol"
                onClick={() => input.current?.click()}
              >
                <ImageUp aria-hidden className="size-5" />
                {t("admin.branding.symbol.choose")}
              </Button>
              <Button
                type="button"
                name="upload-symbol"
                disabled={!picked}
                loading={uploading}
                onClick={() => {
                  void upload();
                }}
              >
                {t("admin.branding.symbol.upload")}
              </Button>
              {history("symbol") > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  name="revert-symbol"
                  onClick={() => {
                    void revertSymbol();
                  }}
                >
                  <Undo2 aria-hidden className="size-5" />
                  {t("admin.branding.symbol.revert")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {warnings.includes("low_contrast") ? (
          <p role="status" className="text-sm font-semibold text-warning">
            {t("admin.branding.warning.low_contrast")}
          </p>
        ) : null}
        {status !== "idle" ? (
          <p role="status" className="text-sm text-text-muted">
            {t(
              status === "generating"
                ? "admin.branding.symbol.generating"
                : status === "generated"
                  ? "admin.branding.symbol.generated"
                  : "admin.branding.symbol.timeout",
            )}
          </p>
        ) : null}
      </Card>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{t("admin.branding.icons.title")}</CardTitle>
          <p className="text-sm text-text-muted">{t("admin.branding.icons.description")}</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {BRANDING_GENERATED_KEYS.map((key) => (
            <BrandIconTile
              key={key}
              assetKey={key}
              asset={assetOf(key)}
              history={history(key)}
              canWrite={canWrite}
              onChanged={reload}
            />
          ))}
        </ul>
      </Card>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{t("admin.branding.extras.title")}</CardTitle>
          <p className="text-sm text-text-muted">{t("admin.branding.extras.description")}</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {EXTRA_KEYS.map((key) => (
            <BrandIconTile
              key={key}
              assetKey={key}
              asset={assetOf(key)}
              history={history(key)}
              canWrite={canWrite}
              onChanged={reload}
            />
          ))}
        </ul>
      </Card>

      <BrandPreviewPanel assets={items} logoUrl={logoUrl} />
    </div>
  );
}
