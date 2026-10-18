"use client";

import { t } from "@wasfa/shared/i18n";
import { JOIN_LINK_APPROVALS, SLUG_PATTERN } from "@wasfa/shared/rewards";
import { Button, Dialog, Field, Input, Select } from "@wasfa/ui";
import { z } from "zod";

import { useApiForm } from "../../lib/forms";
import { createJoinLink } from "../../lib/org-api";
import { endOfDayIso } from "../../lib/org-format";
import { ErrorNotice } from "../error-notice";

/** What the form holds: text from the inputs, turned into the API body on submit. */
const formSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
  maxUses: z
    .string()
    .trim()
    .regex(/^(\d{1,7})?$/),
  expiresOn: z.string().trim(),
  approval: z.enum(JOIN_LINK_APPROVALS),
});

export interface CreateLinkDialogProps {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateLinkForm({ orgId, onClose, onCreated }: Omit<CreateLinkDialogProps, "open">) {
  const form = useApiForm({
    schema: formSchema,
    initial: { slug: "", maxUses: "", expiresOn: "", approval: "auto_approve" },
    submit: async (values) => {
      const maxUses = values.maxUses === "" ? null : Number(values.maxUses);
      await createJoinLink(orgId, {
        slug: values.slug,
        maxUses: maxUses === 0 ? null : maxUses,
        expiresAt: endOfDayIso(values.expiresOn),
        approval: values.approval,
      });
      onCreated();
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("org.links.field.slug")}
        hint={t("org.links.field.slugHint")}
        required
        error={form.errors["slug"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Input {...control} {...form.bind("slug")} ltr autoComplete="off" spellCheck={false} />
        )}
      </Field>
      <Field
        label={t("org.links.field.maxUses")}
        hint={t("org.links.field.maxUsesHint")}
        error={form.errors["maxUses"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("maxUses")} inputMode="numeric" ltr />}
      </Field>
      <Field
        label={t("org.links.field.expires")}
        hint={t("org.links.field.expiresHint")}
        error={form.errors["expiresOn"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("expiresOn")} type="date" ltr />}
      </Field>
      <Field
        label={t("org.links.field.approval")}
        error={form.errors["approval"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Select {...control} {...form.bind("approval")}>
            <option value="auto_approve">{t("org.links.approval.auto_approve")}</option>
            <option value="requires_approval">{t("org.links.approval.requires_approval")}</option>
          </Select>
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} supportHref={null} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="create-link" loading={form.submitting}>
          {t("org.links.create.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Creates a join link: a slug, an optional use limit and expiry, and whether an admin must approve. */
export function CreateLinkDialog({ open, orgId, onClose, onCreated }: CreateLinkDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("org.links.create.title")}
      description={t("org.links.create.lead")}
    >
      {/* Mounted only while open, so every attempt starts with empty fields. */}
      {open ? <CreateLinkForm orgId={orgId} onClose={onClose} onCreated={onCreated} /> : null}
    </Dialog>
  );
}
