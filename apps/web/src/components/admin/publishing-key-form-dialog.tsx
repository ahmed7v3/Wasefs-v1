"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  PUBLISHING_CONTENT_TYPES,
  PUBLISHING_KEY_ENVIRONMENTS,
  PUBLISHING_SCOPES,
} from "@wasfa/shared/publishing";
import {
  publishingKeyIssuedSchema,
  publishingKeySchema,
  type PublishingKey,
  type PublishingKeyIssued,
} from "@wasfa/shared/schemas/admin-publishing-keys";
import { personListResponseSchema } from "@wasfa/shared/schemas/content";
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { TriangleAlert, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import {
  emptyKeyForm,
  formFromKey,
  parseKeyForm,
  patchBody,
  type PublishingKeyFormValues,
} from "../../lib/publishing-admin";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { MediaPickerDialog } from "./media-picker-dialog";

import type { ApiRequestError } from "../../lib/api-error";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface KeyFormDialogProps {
  /** `null` = closed; `{ key: null }` = create; `{ key }` = edit. */
  target: { key: PublishingKey | null } | null;
  onClose: () => void;
  /** Create only: the one-time response, passed up so the secret dialog can show it. */
  onIssued: (issued: PublishingKeyIssued) => void;
  onSaved: () => void;
}

const scopeLabel = (scope: string) => t(`admin.pub.scope.${scope}` as MessageKey);
const scopeDescription = (scope: string) => t(`admin.pub.scope.${scope}.description` as MessageKey);

function KeyForm({
  editing,
  onClose,
  onIssued,
  onSaved,
}: Omit<KeyFormDialogProps, "target"> & { editing: PublishingKey | null }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const people = useResource("/admin/content/people", personListResponseSchema);
  const [values, setValues] = useState<PublishingKeyFormValues>(() =>
    editing ? formFromKey(editing) : emptyKeyForm(),
  );
  const [slug, setSlug] = useState("");
  const [picking, setPicking] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiRequestError | null>(null);

  const patch = (next: Partial<PublishingKeyFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
  };
  const toggle = <T extends string>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

  const addSlug = () => {
    const next = slug.trim();
    if (next !== "" && !values.allowedCategorySlugs.includes(next)) {
      patch({ allowedCategorySlugs: [...values.allowedCategorySlugs, next] });
    }
    setSlug("");
  };

  const chooseImage = (asset: MediaAsset) => {
    patch({
      defaultFeaturedMediaId: asset.id,
      defaultFeaturedMediaLabel: asset.originalFilename ?? asset.id,
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = parseKeyForm(values);
    setInvalid(input === null);
    if (input === null) return;
    setBusy(true);
    setFailure(null);
    try {
      if (editing) {
        await reauth.run(() =>
          api(`/admin/content/api-keys/${editing.id}`, {
            method: "PATCH",
            body: patchBody(input),
            schema: publishingKeySchema,
          }),
        );
        toast({ tone: "success", title: t("admin.pub.form.saved") });
        onSaved();
        onClose();
      } else {
        const issued = await reauth.run(() =>
          api("/admin/content/api-keys", {
            method: "POST",
            body: input,
            schema: publishingKeyIssuedSchema,
          }),
        );
        toast({ tone: "success", title: t("admin.pub.form.created") });
        onSaved();
        onIssued(issued);
        onClose();
      }
    } catch (error) {
      setFailure(toApiError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {editing ? <p className="text-sm text-text-muted">{t("admin.pub.form.editHint")}</p> : null}

      <Field label={t("admin.pub.form.name")} hint={t("admin.pub.form.name.hint")} required>
        {(control) => (
          <Input
            {...control}
            name="name"
            value={values.name}
            maxLength={80}
            onChange={(event) => {
              patch({ name: event.target.value });
            }}
          />
        )}
      </Field>

      {editing ? null : (
        <Field label={t("admin.pub.form.environment")}>
          {(control) => (
            <Select
              {...control}
              name="environment"
              value={values.environment}
              onChange={(event) => {
                patch({ environment: event.target.value === "test" ? "test" : "live" });
              }}
            >
              {PUBLISHING_KEY_ENVIRONMENTS.map((environment) => (
                <option key={environment} value={environment}>
                  {t(`admin.pub.env.${environment}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">{t("admin.pub.form.scopes")}</legend>
        {PUBLISHING_SCOPES.map((scope) => (
          <div key={scope} className="flex flex-col">
            <Checkbox
              name={`scope-${scope}`}
              label={scopeLabel(scope)}
              checked={values.scopes.includes(scope)}
              onChange={() => {
                patch({ scopes: toggle(values.scopes, scope) });
              }}
            />
            <p className="ps-9 text-sm text-text-muted">{scopeDescription(scope)}</p>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Checkbox
          name="canPublish"
          label={t("admin.pub.form.canPublish")}
          checked={values.canPublish}
          onChange={(event) => {
            patch({ canPublish: event.target.checked });
          }}
        />
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm font-semibold text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t("admin.pub.form.canPublish.warning")}
        </p>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">
          {t("admin.pub.form.allowedTypes")}
        </legend>
        <p className="text-sm text-text-muted">{t("admin.pub.form.allowedTypes.hint")}</p>
        <div className="flex flex-wrap gap-x-5">
          {PUBLISHING_CONTENT_TYPES.map((type) => (
            <Checkbox
              key={type}
              name={`type-${type}`}
              label={t(`admin.pub.type.${type}`)}
              checked={values.allowedTypes.includes(type)}
              onChange={() => {
                patch({ allowedTypes: toggle(values.allowedTypes, type) });
              }}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Field label={t("admin.pub.form.categories")} hint={t("admin.pub.form.categories.hint")}>
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                name="categorySlug"
                dir="ltr"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSlug();
                  }
                }}
              />
              <Button type="button" variant="secondary" name="addCategory" onClick={addSlug}>
                {t("admin.pub.form.categories.add")}
              </Button>
            </div>
          )}
        </Field>
        {values.allowedCategorySlugs.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {values.allowedCategorySlugs.map((entry) => (
              <li
                key={entry}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 ps-3 text-sm font-semibold text-neutral-700"
              >
                <bdi dir="ltr">{entry}</bdi>
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-full hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                  aria-label={t("admin.pub.form.categories.remove", { slug: entry })}
                  onClick={() => {
                    patch({
                      allowedCategorySlugs: values.allowedCategorySlugs.filter(
                        (other) => other !== entry,
                      ),
                    });
                  }}
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Field
        label={t("admin.pub.form.defaultAuthor")}
        hint={t("admin.pub.form.defaultAuthor.hint")}
      >
        {(control) => (
          <Select
            {...control}
            name="defaultAuthorId"
            value={values.defaultAuthorId ?? ""}
            onChange={(event) => {
              patch({ defaultAuthorId: event.target.value === "" ? null : event.target.value });
            }}
          >
            <option value="">{t("admin.pub.form.defaultAuthor.none")}</option>
            {people.status === "ready"
              ? people.data.items
                  .filter((person) => person.active || person.id === values.defaultAuthorId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.nameAr}
                    </option>
                  ))
              : null}
          </Select>
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <p className="text-base font-semibold text-text">{t("admin.pub.form.defaultImage")}</p>
        <p className="text-sm text-text-muted">{t("admin.pub.form.defaultImage.hint")}</p>
        <p className="text-sm text-text">
          {values.defaultFeaturedMediaId
            ? (values.defaultFeaturedMediaLabel ?? values.defaultFeaturedMediaId)
            : t("admin.pub.form.defaultImage.none")}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            name="pickImage"
            onClick={() => {
              setPicking(true);
            }}
          >
            {values.defaultFeaturedMediaId
              ? t("admin.pub.form.defaultImage.change")
              : t("admin.pub.form.defaultImage.choose")}
          </Button>
          {values.defaultFeaturedMediaId ? (
            <Button
              type="button"
              variant="ghost"
              name="clearImage"
              onClick={() => {
                patch({ defaultFeaturedMediaId: null, defaultFeaturedMediaLabel: null });
              }}
            >
              {t("admin.pub.form.defaultImage.clear")}
            </Button>
          ) : null}
        </div>
        <MediaPickerDialog open={picking} onOpenChange={setPicking} onSelect={chooseImage} />
      </div>

      <div className="flex flex-col gap-2">
        <Checkbox
          name="globalCapOnly"
          label={t("admin.pub.form.dailyCap.globalOnly")}
          checked={values.globalCapOnly}
          onChange={(event) => {
            patch({ globalCapOnly: event.target.checked });
          }}
        />
        <Field label={t("admin.pub.form.dailyCap")} hint={t("admin.pub.form.dailyCap.hint")}>
          {(control) => (
            <Input
              {...control}
              name="dailyPublishCap"
              type="number"
              inputMode="numeric"
              min={1}
              dir="ltr"
              disabled={values.globalCapOnly}
              value={values.dailyPublishCap}
              onChange={(event) => {
                patch({ dailyPublishCap: event.target.value });
              }}
            />
          )}
        </Field>
      </div>

      <Field label={t("admin.pub.form.rpm")}>
        {(control) => (
          <Input
            {...control}
            name="requestsPerMinute"
            type="number"
            inputMode="numeric"
            min={1}
            dir="ltr"
            value={values.requestsPerMinute}
            onChange={(event) => {
              patch({ requestsPerMinute: event.target.value });
            }}
          />
        )}
      </Field>

      <Field label={t("admin.pub.form.ipAllowList")} hint={t("admin.pub.form.ipAllowList.hint")}>
        {(control) => (
          <Textarea
            {...control}
            name="ipAllowList"
            dir="ltr"
            rows={3}
            value={values.ipAllowList}
            onChange={(event) => {
              patch({ ipAllowList: event.target.value });
            }}
          />
        )}
      </Field>

      {editing ? null : (
        <Field label={t("admin.pub.form.expiresInDays")}>
          {(control) => (
            <Input
              {...control}
              name="expiresInDays"
              type="number"
              inputMode="numeric"
              min={1}
              dir="ltr"
              value={values.expiresInDays}
              onChange={(event) => {
                patch({ expiresInDays: event.target.value });
              }}
            />
          )}
        </Field>
      )}

      {invalid ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t("admin.pub.form.invalid")}
        </p>
      ) : null}
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="submit" loading={busy}>
          {editing ? t("admin.pub.form.submitEdit") : t("admin.pub.form.submitCreate")}
        </Button>
      </div>
    </form>
  );
}

/** Create or edit a key. The form mounts only while open, so each use starts from a clean state. */
export function KeyFormDialog({ target, ...rest }: KeyFormDialogProps) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) rest.onClose();
      }}
      title={target?.key ? t("admin.pub.form.editTitle") : t("admin.pub.form.createTitle")}
    >
      {target ? <KeyForm editing={target.key} {...rest} /> : null}
    </Dialog>
  );
}
