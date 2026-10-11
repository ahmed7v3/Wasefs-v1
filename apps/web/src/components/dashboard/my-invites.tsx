"use client";

import { t } from "@wasfa/shared/i18n";
import { myInviteListResponseSchema, orgResponseSchema } from "@wasfa/shared/schemas/org";
import { Button, buttonStyles, useToast } from "@wasfa/ui";
import { MailPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { formatDate } from "../../lib/dates";
import { readStoredInviteToken } from "../../lib/invite-storage";
import { label } from "../../lib/labels";
import { ErrorNotice } from "../error-notice";

type Invite = z.output<typeof myInviteListResponseSchema>["items"][number];

const subscribeNothing = () => () => undefined;

/** Browser-only fact: the server render and the first client render both say "no", then React re-reads it. */
function useStoredInviteToken(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => readStoredInviteToken() !== null,
    () => false,
  );
}

/**
 * Invitations addressed to the user's verified email or phone (`GET /me/invites`), with an accept
 * button, plus a reminder when an invitation link was opened earlier in this tab but not accepted.
 * Renders nothing while loading and when there is nothing to show.
 */
export function MyInvites() {
  const router = useRouter();
  const { toast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<unknown>(null);
  const hasStoredToken = useStoredInviteToken();

  useEffect(() => {
    const controller = new AbortController();
    api("/me/invites", { schema: myInviteListResponseSchema, signal: controller.signal })
      .then((result) => {
        setInvites(result.items);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(error);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const accept = (invite: Invite) => {
    setAccepting(invite.id);
    setAcceptError(null);
    api(`/me/invites/${invite.id}/accept`, { method: "POST", schema: orgResponseSchema })
      .then((org) => {
        setInvites((current) => current.filter((item) => item.id !== invite.id));
        toast({ tone: "success", title: t("dashboard.invites.accepted", { org: org.name }) });
        // The shell and `me.organizations` come from the server.
        router.refresh();
      })
      .catch((error: unknown) => {
        setAcceptError(error);
      })
      .finally(() => {
        setAccepting(null);
      });
  };

  if (invites.length === 0 && !hasStoredToken && !loadError) return null;

  return (
    <section aria-labelledby="invites-title" className="flex flex-col gap-4">
      <h2 id="invites-title" className="font-heading text-2xl font-semibold text-text">
        {t("dashboard.invites.title")}
      </h2>
      {hasStoredToken ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary-soft p-4">
          <p className="flex-1 text-base text-text">{t("dashboard.invites.stored")}</p>
          <Link href="/invite" className={buttonStyles({ variant: "secondary" })}>
            {t("dashboard.invites.finish")}
          </Link>
        </div>
      ) : null}
      {loadError ? <ErrorNotice error={loadError} /> : null}
      {acceptError ? <ErrorNotice error={acceptError} /> : null}
      <ul className="flex flex-col gap-3">
        {invites.map((invite) => {
          const text = t("dashboard.invites.item", {
            org: invite.orgName,
            role: label("orgRole", invite.role),
          });
          return (
            <li
              key={invite.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-surface p-4 shadow-card"
            >
              <span
                aria-hidden
                className="inline-flex size-12 items-center justify-center rounded-lg bg-primary-soft text-primary"
              >
                <MailPlus className="size-6" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-base font-semibold text-text">{text}</p>
                <p className="text-sm text-text-muted">
                  {t("dashboard.invites.expires", { date: formatDate(invite.expiresAt) })}
                </p>
              </div>
              <Button
                name="accept-invite"
                loading={accepting === invite.id}
                disabled={accepting !== null}
                aria-label={t("dashboard.invites.acceptLabel", { org: invite.orgName })}
                onClick={() => {
                  accept(invite);
                }}
              >
                {t("dashboard.invites.accept")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
