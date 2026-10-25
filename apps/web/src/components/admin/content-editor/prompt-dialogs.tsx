"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Dialog, Field, Input } from "@wasfa/ui";
import { useState, type FormEvent } from "react";

import { AssetThumb } from "./asset-thumb";

import type { MediaAsset } from "@wasfa/shared/schemas/media";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface EntityPromptDialogProps {
  open: boolean;
  kind: "drug" | "glossary";
  onCancel: () => void;
  onConfirm: (slug: string) => void;
}

function EntityForm({ kind, onCancel, onConfirm }: Omit<EntityPromptDialogProps, "open">) {
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const clean = slug.trim().toLowerCase();
  const valid = SLUG.test(clean);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (valid) onConfirm(clean);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        label={t(
          kind === "drug" ? "admin.editor.entity.drug.label" : "admin.editor.entity.glossary.label",
        )}
        hint={t("admin.editor.entity.hint")}
        required
        error={touched && !valid ? t("admin.editor.entity.invalid") : undefined}
        announceError={touched}
      >
        {(control) => (
          <Input
            {...control}
            ltr
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">{t("admin.editor.entity.insert")}</Button>
      </div>
    </form>
  );
}

/** Asks for the slug of the drug / glossary entry to link: `{{drug:<slug>}}`. */
export function EntityPromptDialog({ open, kind, onCancel, onConfirm }: EntityPromptDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t(
        kind === "drug" ? "admin.editor.entity.drug.title" : "admin.editor.entity.glossary.title",
      )}
    >
      {open ? <EntityForm kind={kind} onCancel={onCancel} onConfirm={onConfirm} /> : null}
    </Dialog>
  );
}

export interface AltPromptDialogProps {
  open: boolean;
  asset: MediaAsset | null;
  /** The alt text is required: an image without it blocks publishing (CONTENT-PLATFORM §6.2). */
  locale: "ar" | "en";
  onCancel: () => void;
  onConfirm: (input: { alt: string; caption: string }) => void;
}

function AltForm({
  asset,
  locale,
  onCancel,
  onConfirm,
}: Omit<AltPromptDialogProps, "open"> & { asset: MediaAsset }) {
  const [alt, setAlt] = useState((locale === "en" ? asset.altEn : asset.altAr) ?? "");
  const [caption, setCaption] = useState(asset.caption ?? "");
  const [touched, setTouched] = useState(false);
  const valid = alt.trim() !== "";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setTouched(true);
    if (valid) onConfirm({ alt: alt.trim(), caption: caption.trim() });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <AssetThumb asset={asset} className="mx-auto max-w-48 rounded-lg" />
      <Field
        label={t("admin.editor.alt.label")}
        hint={t("admin.editor.alt.hint")}
        required
        error={touched && !valid ? t("admin.editor.alt.required") : undefined}
        announceError={touched}
      >
        {(control) => (
          <Input
            {...control}
            dir="auto"
            autoFocus
            maxLength={300}
            value={alt}
            onChange={(event) => {
              setAlt(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={t("admin.editor.alt.caption")} hint={t("admin.editor.alt.captionHint")}>
        {(control) => (
          <Input
            {...control}
            dir="auto"
            maxLength={300}
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">{t("admin.editor.alt.insert")}</Button>
      </div>
    </form>
  );
}

/** Alt text (required) and an optional caption before an image is inserted into the body. */
export function AltPromptDialog({
  open,
  asset,
  locale,
  onCancel,
  onConfirm,
}: AltPromptDialogProps) {
  return (
    <Dialog
      open={open && asset !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("admin.editor.alt.title")}
    >
      {open && asset ? (
        <AltForm
          key={asset.id}
          asset={asset}
          locale={locale}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
}
