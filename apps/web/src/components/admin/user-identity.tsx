"use client";

import { t } from "@wasfa/shared/i18n";
import { Avatar, Badge, Button, useToast, type AvatarSize } from "@wasfa/ui";
import { Copy } from "lucide-react";

import { tOr } from "../../lib/admin-format";

import { Code } from "./badges";

/** Sign-in methods as chips; an unknown provider shows its raw id. */
export function ProviderChips({ providers }: { providers: readonly string[] }) {
  if (providers.length === 0)
    return <span className="text-text-muted">{t("admin.users.noProviders")}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {providers.map((provider) => (
        <Badge key={provider} tone="neutral" className="py-0.5">
          {tOr(`admin.users.provider.${provider}`, provider)}
        </Badge>
      ))}
    </span>
  );
}

/** The user id as a code with a button that copies it. */
export function CopyableUserId({ id }: { id: string }) {
  const { toast } = useToast();
  const copy = () => {
    navigator.clipboard.writeText(id).then(
      () => {
        toast({ tone: "success", title: t("admin.users.idCopied") });
      },
      () => {
        toast({ tone: "error", title: t("admin.users.idCopyFailed") });
      },
    );
  };
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Code>{id}</Code>
      <Button
        variant="ghost"
        name="copy-user-id"
        aria-label={t("admin.users.copyId")}
        onClick={copy}
      >
        <Copy aria-hidden className="size-4" />
      </Button>
    </span>
  );
}

/** Avatar (profile picture or initials) with the name and the e-mail stacked beside it. */
export function UserCell({
  name,
  email,
  phone,
  image,
  size = 32,
}: {
  name: string;
  email: string | null;
  phone?: string | null | undefined;
  image: string | null;
  size?: AvatarSize;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} src={image} size={size} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{name}</span>
        {email ? (
          <bdi dir="ltr" className="truncate text-sm font-normal text-text-muted">
            {email}
          </bdi>
        ) : null}
        {!email && phone ? (
          <bdi dir="ltr" className="truncate text-sm font-normal text-text-muted">
            {phone}
          </bdi>
        ) : null}
      </span>
    </span>
  );
}
