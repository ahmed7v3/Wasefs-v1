"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, Container, EmptyState, buttonStyles } from "@wasfa/ui";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { loginPath } from "../../lib/route-guard";
import { ErrorNotice } from "../error-notice";

import type { AdminAccess } from "../../lib/admin-server";

/** A page the signed-in admin may not open (DESIGN-SYSTEM §7: calm, not an error page). */
export function ForbiddenState() {
  return (
    <Card elevation="flat">
      <EmptyState
        icon={<LockKeyhole />}
        title={t("admin.forbidden.title")}
        description={t("admin.forbidden.body")}
        action={
          <Link href="/admin" className={buttonStyles({ variant: "secondary" })}>
            {t("admin.forbidden.action")}
          </Link>
        }
      />
    </Card>
  );
}

function SignInAgain() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const signOutAndLogin = () => {
    setBusy(true);
    setError(null);
    api("/auth/sign-out", { method: "POST" }).then(
      () => {
        // A full navigation: nothing of the old session survives in memory.
        window.location.assign(loginPath("/admin"));
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure);
      },
    );
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <Button onClick={signOutAndLogin} loading={busy}>
        {t("admin.access.sessionAction")}
      </Button>
      {error ? <ErrorNotice error={error} /> : null}
    </div>
  );
}

const COPY = {
  two_factor_required: {
    title: "admin.access.twoFactorRequired.title",
    body: "admin.access.twoFactorRequired.body",
  },
  two_factor_session: {
    title: "admin.access.twoFactorSession.title",
    body: "admin.access.twoFactorSession.body",
  },
  forbidden: { title: "admin.forbidden.title", body: "admin.forbidden.body" },
} as const;

export interface AdminAccessStateProps {
  reason: Exclude<AdminAccess, "ok"> | "forbidden";
}

/**
 * Full-page notice that replaces the admin frame: the account has no admin permission, has not
 * enabled two-factor, or is signed in with a session that has not gone through it. Not a redirect:
 * the person needs to be told what to do.
 */
export function AdminAccessState({ reason }: AdminAccessStateProps) {
  const copy = COPY[reason];
  return (
    <div className="page-backdrop min-h-dvh">
      <Container width="reading" className="grid min-h-dvh place-items-center py-10">
        <main id="main" className="w-full">
          <Card elevation="raised" className="flex flex-col items-center gap-4 text-center">
            <span
              aria-hidden
              className="inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary"
            >
              <ShieldAlert className="size-7" />
            </span>
            <h1 className="font-heading text-3xl font-bold text-primary">{t(copy.title)}</h1>
            <p className="text-base text-text-muted">{t(copy.body)}</p>
            {reason === "two_factor_required" ? (
              <Link href="/account/security" className={buttonStyles()}>
                {t("admin.access.twoFactorAction")}
              </Link>
            ) : null}
            {reason === "two_factor_session" ? <SignInAgain /> : null}
            {reason === "forbidden" ? (
              <Link href="/dashboard" className={buttonStyles({ variant: "secondary" })}>
                {t("common.backHome")}
              </Link>
            ) : null}
          </Card>
        </main>
      </Container>
    </div>
  );
}
