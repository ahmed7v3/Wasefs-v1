"use client";

import { PERSON_ROLES } from "@wasfa/shared/content/constants";
import { t } from "@wasfa/shared/i18n";
import { personSchema, type Person } from "@wasfa/shared/schemas/content";
import { mediaAssetSchema } from "@wasfa/shared/schemas/media";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from "@wasfa/ui";
import { ImagePlus, Plus, X } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { personFormSchema, type PersonFormValues } from "../../lib/content-admin-schemas";
import { isHttpsUrl, plainExcerpt } from "../../lib/content-people";
import { useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { PersonUserPicker, type LinkedUser } from "./content-person-user-picker";
import { SlugField } from "./content-slug-field";
import { MediaPickerDialog } from "./media-picker-dialog";
import { MediaThumb } from "./media-thumb";

export interface PersonDialogProps {
  open: boolean;
  /** `null` creates; a person opens it for editing. */
  person: Person | null;
  onClose: () => void;
  onSaved: () => void;
}

function initialValues(person: Person | null): PersonFormValues {
  return {
    slug: person?.slug ?? "",
    nameAr: person?.nameAr ?? "",
    nameEn: person?.nameEn ?? "",
    role: person?.role ?? "author",
    credentialsAr: person?.credentialsAr ?? "",
    credentialsEn: person?.credentialsEn ?? "",
    licenceNumber: person?.licenceNumber ?? "",
    showLicence: person?.showLicence ?? false,
    bioMdAr: person?.bioMdAr ?? "",
    bioMdEn: person?.bioMdEn ?? "",
    photoMediaId: person?.photoMediaId ?? "",
    sameAs: person?.sameAs ?? [],
    userId: person?.userId ?? "",
    active: person?.active ?? true,
  };
}

function PhotoField({ mediaId, onChange }: { mediaId: string; onChange: (id: string) => void }) {
  const [picking, setPicking] = useState(false);
  const asset = useResource(mediaId ? `/admin/media/${mediaId}` : null, mediaAssetSchema);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-base font-semibold text-text">{t("admin.content.person.photo")}</span>
      <div className="flex flex-wrap items-center gap-3">
        {mediaId && asset.status === "ready" ? (
          <div className="size-20 overflow-hidden rounded-full">
            <MediaThumb asset={asset.data} />
          </div>
        ) : null}
        <Button
          variant="secondary"
          name="pick-photo"
          onClick={() => {
            setPicking(true);
          }}
        >
          <ImagePlus aria-hidden className="size-5" />
          {t(mediaId ? "admin.content.person.photoChange" : "admin.content.person.photoPick")}
        </Button>
        {mediaId ? (
          <Button
            variant="ghost"
            name="clear-photo"
            onClick={() => {
              onChange("");
            }}
          >
            {t("admin.content.person.photoRemove")}
          </Button>
        ) : null}
      </div>
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        onSelect={(selected) => {
          onChange(selected.id);
        }}
      />
    </div>
  );
}

function SameAsEditor({
  value,
  onChange,
  error,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  error: string | undefined;
}) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const add = () => {
    const url = draft.trim();
    if (url === "") return;
    if (!isHttpsUrl(url)) {
      setDraftError(t("admin.content.person.sameAsInvalid"));
      return;
    }
    if (!value.includes(url)) onChange([...value, url]);
    setDraft("");
    setDraftError(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <Field
        label={t("admin.content.person.sameAs")}
        hint={t("admin.content.person.sameAsHint")}
        error={draftError ?? error}
        announceError={draftError !== null}
      >
        {(control) => (
          <div className="flex items-start gap-2">
            <Input
              {...control}
              name="sameAsDraft"
              type="url"
              ltr
              autoComplete="off"
              placeholder="https://"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="secondary" name="add-sameas" className="shrink-0" onClick={add}>
              <Plus aria-hidden className="size-5" />
              {t("admin.content.person.sameAsAdd")}
            </Button>
          </div>
        )}
      </Field>
      {value.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {value.map((url) => (
            <li key={url} className="flex items-center gap-2 rounded-lg bg-neutral-100 ps-3">
              <bdi dir="ltr" className="min-w-0 flex-1 break-all text-start text-sm">
                {url}
              </bdi>
              <button
                type="button"
                aria-label={t("admin.content.person.sameAsRemove", { url })}
                onClick={() => {
                  onChange(value.filter((other) => other !== url));
                }}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:text-danger focus-visible:outline-none focus-visible:shadow-focus"
              >
                <X aria-hidden className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** How the public author page will introduce this person: name, credentials and a plain bio excerpt. */
export function ProfilePreview({
  name,
  credentials,
  bio,
}: {
  name: string;
  credentials: string;
  bio: string;
}) {
  return (
    <Card
      elevation="flat"
      padding="compact"
      className="flex flex-col gap-1"
      data-testid="profile-preview"
    >
      <p className="text-sm font-semibold text-text-muted">{t("admin.content.person.preview")}</p>
      <p className="font-heading text-lg font-semibold text-text">
        {name || t("admin.content.person.previewName")}
      </p>
      {credentials ? <p className="text-sm text-primary">{credentials}</p> : null}
      <p className="text-base text-text">
        {plainExcerpt(bio) || t("admin.content.person.previewBio")}
      </p>
    </Card>
  );
}

function PersonForm({ person, onClose, onSaved }: Omit<PersonDialogProps, "open">) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const form = useApiForm({
    schema: personFormSchema,
    initial: initialValues(person),
    submit: async (values) => {
      await reauth.run(() =>
        api(person ? `/admin/content/people/${person.id}` : "/admin/content/people", {
          method: person ? "PATCH" : "POST",
          body: values,
          schema: personSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.content.person.saved") });
      onSaved();
      onClose();
    },
  });
  const announce = form.submitCount > 0;
  const field = (name: keyof PersonFormValues & string) => String(form.values[name] ?? "");
  const userId = field("userId");
  const showLicence = form.values.showLicence === true;

  const text = (
    name: "nameAr" | "nameEn" | "credentialsAr" | "credentialsEn" | "licenceNumber",
    label: string,
    options: { ltr?: boolean; required?: boolean; hint?: string } = {},
  ) => (
    <Field
      label={label}
      hint={options.hint}
      required={options.required}
      error={form.errors[name]}
      announceError={announce}
    >
      {(control) => (
        <Input {...control} {...form.bind(name)} ltr={options.ltr} autoComplete="off" />
      )}
    </Field>
  );
  const area = (name: "bioMdAr" | "bioMdEn", label: string, ltr = false) => (
    <Field
      label={label}
      hint={t("admin.content.person.bioHint")}
      error={form.errors[name]}
      announceError={announce}
    >
      {(control) => (
        <Textarea
          {...control}
          name={name}
          ltr={ltr}
          rows={5}
          value={field(name)}
          onChange={(event) => {
            form.setValue(name, event.target.value);
          }}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      {text("nameAr", t("admin.content.field.nameAr"), { required: true })}
      {text("nameEn", t("admin.content.field.nameEn"), { ltr: true })}
      <SlugField
        name="slug"
        label={t("admin.content.field.slug")}
        value={field("slug")}
        onChange={(value) => {
          form.setValue("slug", value);
        }}
        suggestFrom={field("nameEn") || field("nameAr")}
        error={form.errors["slug"]}
        announceError={announce}
        required
      />
      <Field
        label={t("admin.content.person.role")}
        error={form.errors["role"]}
        announceError={announce}
      >
        {(control) => (
          <Select {...control} {...form.bind("role")}>
            {PERSON_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`admin.content.person.role.${role}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {text("credentialsAr", t("admin.content.person.credentialsAr"))}
      {text("credentialsEn", t("admin.content.person.credentialsEn"), { ltr: true })}

      {text("licenceNumber", t("admin.content.person.licence"), { ltr: true })}
      <div className="flex flex-col gap-1">
        <Checkbox
          {...form.bindCheckbox("showLicence")}
          label={t("admin.content.person.showLicence")}
        />
        <p
          className={
            showLicence ? "ps-9 text-sm font-semibold text-warning" : "ps-9 text-sm text-text-muted"
          }
        >
          {t(
            showLicence
              ? "admin.content.person.showLicenceOn"
              : "admin.content.person.showLicenceOff",
          )}
        </p>
      </div>

      {area("bioMdAr", t("admin.content.person.bioAr"))}
      {area("bioMdEn", t("admin.content.person.bioEn"), true)}
      <ProfilePreview
        name={field("nameAr")}
        credentials={field("credentialsAr")}
        bio={field("bioMdAr")}
      />

      <PhotoField
        mediaId={field("photoMediaId")}
        onChange={(id) => {
          form.setValue("photoMediaId", id);
        }}
      />

      <SameAsEditor
        value={Array.isArray(form.values.sameAs) ? (form.values.sameAs as string[]) : []}
        onChange={(next) => {
          form.setValue("sameAs", next);
        }}
        error={form.errors["sameAs"]}
      />

      <PersonUserPicker
        value={userId ? { id: userId, name: linkedName } : null}
        onChange={(next: LinkedUser | null) => {
          setLinkedName(next?.name ?? null);
          form.setValue("userId", next?.id ?? "");
        }}
      />

      <Checkbox {...form.bindCheckbox("active")} label={t("admin.content.person.active")} />

      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={form.submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function PersonDialog({ open, ...form }: PersonDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.onClose();
      }}
      title={
        form.person
          ? t("admin.content.person.editTitle", { name: form.person.nameAr })
          : t("admin.content.person.newTitle")
      }
    >
      {open ? <PersonForm {...form} /> : null}
    </Dialog>
  );
}
