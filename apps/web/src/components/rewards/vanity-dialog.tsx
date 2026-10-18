"use client";

import { t } from "@wasfa/shared/i18n";
import { meReferralSchema, updateReferralCodeSchema } from "@wasfa/shared/schemas/rewards";
import { Button, Dialog, Field, Input, useToast } from "@wasfa/ui";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

export interface VanityDialogProps {
  code: string;
  /** The one-time edit was already used. */
  edited: boolean;
  onRenamed: () => void;
}

function VanityForm({
  code,
  onClose,
  onRenamed,
}: Pick<VanityDialogProps, "code" | "onRenamed"> & { onClose: () => void }) {
  const { toast } = useToast();
  const form = useApiForm({
    schema: updateReferralCodeSchema,
    initial: { code },
    submit: async (values) => {
      const updated = await api("/me/referral", {
        method: "PATCH",
        body: values,
        schema: meReferralSchema,
      });
      toast({ tone: "success", title: t("rewardsPage.vanity.saved", { code: updated.code }) });
      onRenamed();
      onClose();
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("rewardsPage.vanity.field")}
        hint={t("rewardsPage.vanity.hint")}
        required
        error={form.errors["code"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Input {...control} {...form.bind("code")} ltr autoComplete="off" spellCheck={false} />
        )}
      </Field>
      <p className="rounded-md bg-warning-soft p-3 text-base text-text">
        {t("rewardsPage.vanity.once")}
      </p>
      {form.formError ? <ErrorNotice error={form.formError} supportHref={null} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save-code" loading={form.submitting}>
          {t("rewardsPage.vanity.confirm")}
        </Button>
      </div>
    </form>
  );
}

/** The one-time custom code: a button that says so, and a dialog that repeats it before saving. */
export function VanityDialog({ code, edited, onRenamed }: VanityDialogProps) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        name="edit-code"
        disabled={edited}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Pencil aria-hidden className="size-4" />
        {edited ? t("rewardsPage.vanity.used") : t("rewardsPage.vanity.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t("rewardsPage.vanity.title")}
        description={t("rewardsPage.vanity.lead")}
      >
        {open ? <VanityForm code={code} onClose={close} onRenamed={onRenamed} /> : null}
      </Dialog>
    </>
  );
}
