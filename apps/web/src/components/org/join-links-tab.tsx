"use client";

import { t } from "@wasfa/shared/i18n";
import { joinLinkListResponseSchema, type JoinLinkItem } from "@wasfa/shared/schemas/org";
import { Badge, Button, Dialog, EmptyState, Skeleton, useToast, type BadgeTone } from "@wasfa/ui";
import { Copy, Link2, Plus, QrCode } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { formatDate } from "../../lib/dates";
import { publicEnv } from "../../lib/env";
import { disableJoinLink, orgJoinLinksPath } from "../../lib/org-api";
import { joinUrl } from "../../lib/org-format";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice, errorMessage } from "../error-notice";

import { CreateLinkDialog } from "./create-link-dialog";
import { LinkQr } from "./link-qr";

type LinkState = "active" | "disabled" | "expired" | "used_up";

function linkState(link: JoinLinkItem, now: number): LinkState {
  if (!link.active) return "disabled";
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= now) return "expired";
  if (link.maxUses !== null && link.usedCount >= link.maxUses) return "used_up";
  return "active";
}

const STATE_TONE: Record<LinkState, BadgeTone> = {
  active: "success",
  disabled: "neutral",
  expired: "warning",
  used_up: "warning",
};

export interface JoinLinksTabProps {
  orgId: string;
  /** The dashboard counters change when a link is created or disabled. */
  onChanged: () => void;
}

function LinkRow({
  link,
  now,
  onDisable,
}: {
  link: JoinLinkItem;
  now: number;
  onDisable: (link: JoinLinkItem) => void;
}) {
  const { toast } = useToast();
  const [showQr, setShowQr] = useState(false);
  const state = linkState(link, now);
  const url = joinUrl(publicEnv.NEXT_PUBLIC_SITE_URL, link.slug);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ tone: "success", title: t("org.links.copied") });
    } catch {
      toast({ tone: "error", title: t("org.links.copyFailed") });
    }
  };

  return (
    <li className="flex flex-col gap-3 p-4" data-testid="join-link">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p dir="ltr" className="truncate text-start font-mono text-base font-semibold text-text">
            {url}
          </p>
          <p className="text-sm text-text-muted">
            {t("org.links.uses", {
              used: formatNumber(link.usedCount),
              max: link.maxUses === null ? t("org.links.unlimited") : formatNumber(link.maxUses),
            })}
            {" · "}
            {link.expiresAt
              ? t("org.links.expiresOn", { date: formatDate(link.expiresAt) })
              : t("org.links.noExpiry")}
            {" · "}
            {t(`org.links.approval.${link.approval}`)}
          </p>
        </div>
        <Badge tone={STATE_TONE[state]}>{t(`org.links.state.${state}`)}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            void copy();
          }}
        >
          <Copy aria-hidden className="size-4" />
          {t("org.links.copy")}
          <span className="sr-only"> {link.slug}</span>
        </Button>
        <Button
          variant="secondary"
          aria-expanded={showQr}
          onClick={() => {
            setShowQr((current) => !current);
          }}
        >
          <QrCode aria-hidden className="size-4" />
          {showQr ? t("org.links.hideQr") : t("org.links.showQr")}
          <span className="sr-only"> {link.slug}</span>
        </Button>
        {link.active ? (
          <Button
            variant="ghost"
            onClick={() => {
              onDisable(link);
            }}
          >
            {t("org.links.disable")}
            <span className="sr-only"> {link.slug}</span>
          </Button>
        ) : null}
      </div>
      {showQr ? <LinkQr url={url} label={link.slug} /> : null}
    </li>
  );
}

/** The join links of the organization: create, copy, show a QR code, disable. */
export function JoinLinksTab({ orgId, onChanged }: JoinLinksTabProps) {
  const { toast } = useToast();
  const links = useResource(orgJoinLinksPath(orgId), joinLinkListResponseSchema);
  const [creating, setCreating] = useState(false);
  const [disabling, setDisabling] = useState<JoinLinkItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const confirmDisable = async () => {
    if (!disabling) return;
    setBusy(true);
    try {
      await disableJoinLink(orgId, disabling.id);
      toast({ tone: "success", title: t("org.links.disabled") });
      setDisabling(null);
      links.reload();
      onChanged();
    } catch (error) {
      toast({
        tone: "error",
        title: t("org.links.disableFailed"),
        description: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="org-links-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="org-links-title" className="font-heading text-xl font-bold text-text">
            {t("org.links.title")}
          </h2>
          <p className="text-base text-text-muted">{t("org.links.lead")}</p>
        </div>
        <Button
          name="new-link"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t("org.links.new")}
        </Button>
      </div>

      {links.status === "loading" ? (
        <Skeleton className="h-32 w-full" />
      ) : links.status === "error" ? (
        <ErrorNotice error={links.error} onRetry={links.reload} supportHref={null} />
      ) : links.data.items.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title={t("org.links.empty")}
          description={t("org.links.emptyHint")}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60 bg-surface">
          {links.data.items.map((link) => (
            <LinkRow key={link.id} link={link} now={now} onDisable={setDisabling} />
          ))}
        </ul>
      )}

      <CreateLinkDialog
        open={creating}
        orgId={orgId}
        onClose={() => {
          setCreating(false);
        }}
        onCreated={() => {
          setCreating(false);
          toast({ tone: "success", title: t("org.links.created") });
          links.reload();
          onChanged();
        }}
      />
      <Dialog
        open={disabling !== null}
        onOpenChange={(next) => {
          if (!next) setDisabling(null);
        }}
        title={t("org.links.disableTitle")}
        description={t("org.links.disableBody", { slug: disabling?.slug ?? "" })}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setDisabling(null);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              name="confirm-disable"
              loading={busy}
              onClick={() => {
                void confirmDisable();
              }}
            >
              {t("org.links.disableConfirm")}
            </Button>
          </>
        }
      />
    </section>
  );
}
