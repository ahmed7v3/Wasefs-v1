"use client";

import { t } from "@wasfa/shared/i18n";
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  PERMISSION_KEYS,
  type Permission,
  type PermissionGroup,
} from "@wasfa/shared/permissions";
import { createRoleSchema, roleSchema, type AdminRole } from "@wasfa/shared/schemas/admin";
import { Button, Checkbox, Dialog, Field, Input, useToast } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { toApiError, serverFieldErrors, validateValues } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

/** Editing an existing role: the key is fixed, so its (reserved-name) rule does not apply. */
const editRoleSchema = createRoleSchema.omit({ key: true });

const GROUP_ORDER = Object.keys(PERMISSION_GROUPS) as PermissionGroup[];

export interface RoleDialogProps {
  /** `null` creates a role; a role opens it for editing, or for viewing when `readOnly`. */
  role: AdminRole | null;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function RoleForm({ role, readOnly, onClose, onSaved }: RoleDialogProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const creating = role === null;
  const isWildcard = role?.key === "super_admin";

  const [key, setKey] = useState("");
  const [nameAr, setNameAr] = useState(role?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(role?.nameEn ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(role ? [...role.permissions] : []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const togglePermission = (permission: Permission, on: boolean) => {
    setPermissions((current) =>
      on ? [...current, permission] : current.filter((entry) => entry !== permission),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || readOnly) return;
    const body = { nameAr, nameEn, permissions };
    const schema = creating ? createRoleSchema : editRoleSchema;
    const values = creating ? { key, ...body } : body;
    const invalid = validateValues(schema, values);
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const send = () =>
      creating
        ? api("/admin/roles", { method: "POST", body: { key, ...body }, schema: roleSchema })
        : api(`/admin/roles/${encodeURIComponent(role.key)}`, {
            method: "PATCH",
            body,
            schema: roleSchema,
          });
    reauth.run(send).then(
      () => {
        toast({
          tone: "success",
          title: t(creating ? "admin.roles.created" : "admin.roles.updated", {
            name: nameAr,
          }),
        });
        onSaved();
        onClose();
      },
      (error: unknown) => {
        setSubmitting(false);
        const mapped = serverFieldErrors(error, schema, values, Object.keys(values));
        if (mapped) {
          setErrors(mapped);
          setSubmitCount((count) => count + 1);
        } else {
          setFormError(toApiError(error));
        }
      },
    );
  };

  const shown = isWildcard ? [...PERMISSION_KEYS] : permissions;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {isWildcard ? (
        <p className="rounded-md border border-primary/20 bg-primary-soft p-3 text-base text-text">
          {t("admin.roles.wildcard")}
        </p>
      ) : null}
      {creating ? (
        <Field
          label={t("admin.roles.field.key")}
          hint={t("admin.roles.field.keyHint")}
          required
          error={errors["key"]}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              name="key"
              ltr
              autoComplete="off"
              value={key}
              onChange={(event) => {
                setKey(event.target.value.trim());
              }}
            />
          )}
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("admin.roles.field.nameAr")}
          required
          error={errors["nameAr"]}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              name="nameAr"
              value={nameAr}
              disabled={readOnly}
              onChange={(event) => {
                setNameAr(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.roles.field.nameEn")}
          required
          error={errors["nameEn"]}
          announceError={submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              name="nameEn"
              ltr
              value={nameEn}
              disabled={readOnly}
              onChange={(event) => {
                setNameEn(event.target.value);
              }}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className="font-heading text-lg font-semibold text-text">
          {t("admin.roles.permissions")}
        </h3>
        {GROUP_ORDER.map((group) => {
          const items = PERMISSION_KEYS.filter(
            (permission) => PERMISSIONS[permission].group === group,
          );
          if (items.length === 0) return null;
          return (
            <fieldset key={group} className="flex flex-col gap-1">
              <legend className="mb-1 text-base font-semibold text-primary">
                {PERMISSION_GROUPS[group].ar}
              </legend>
              {items.map((permission) => (
                <Checkbox
                  key={permission}
                  name={permission}
                  label={PERMISSIONS[permission].label.ar}
                  checked={shown.includes(permission)}
                  disabled={readOnly}
                  onChange={(event) => {
                    togglePermission(permission, event.target.checked);
                  }}
                />
              ))}
            </fieldset>
          );
        })}
        {errors["permissions"] ? (
          <p role="alert" className="text-sm text-danger">
            {errors["permissions"]}
          </p>
        ) : null}
      </div>

      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {readOnly ? t("ui.close") : t("common.cancel")}
        </Button>
        {readOnly ? null : (
          <Button type="submit" name="save" loading={submitting}>
            {creating ? t("admin.roles.create") : t("common.save")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Role editor (super_admin only): names and the permission checklist grouped like the catalog. */
export function RoleDialog(props: RoleDialogProps & { open: boolean }) {
  const { open, ...form } = props;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.onClose();
      }}
      title={
        form.role === null
          ? t("admin.roles.newTitle")
          : form.readOnly
            ? t("admin.roles.viewTitle", { name: form.role.nameAr })
            : t("admin.roles.editTitle", { name: form.role.nameAr })
      }
      className="sm:max-w-2xl"
    >
      {/* Mounted only while open: every opening starts from the role as it is now. */}
      {open ? <RoleForm {...form} /> : null}
    </Dialog>
  );
}
