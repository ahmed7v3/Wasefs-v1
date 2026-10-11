"use client";

import { t } from "@wasfa/shared/i18n";
import { acceptInviteTokenSchema, orgResponseSchema } from "@wasfa/shared/schemas/org";
import { meResponseSchema } from "@wasfa/shared/schemas/user";
import { Button, Spinner, buttonStyles, useToast } from "@wasfa/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { clearStoredInviteToken, takeInviteToken } from "../../lib/invite-storage";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

type Phase =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "signed_out" }
  | { kind: "ready" }
  | { kind: "not_found" }
  | { kind: "already_member" }
  | { kind: "error"; error: unknown };

/** The signed-in person has no session (any 401, including one that expired while the page was open). */
function isSignedOut(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "AUTH_REQUIRED";
}

/**
 * Accepting an organization invitation from the emailed link `/invite#<token>`. The token lives in
 * the URL fragment, so no redirect on the way here could keep it: `takeInviteToken` moves it to
 * `sessionStorage` and clears the fragment, which lets a sign-in or registration detour come back.
 */
export function InviteAccept() {
  const router = useRouter();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [token, setToken] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const found = takeInviteToken();
      if (!found || !acceptInviteTokenSchema.safeParse({ token: found }).success) {
        setPhase({ kind: "missing" });
        return;
      }
      setToken(found);
      try {
        await api("/me", { schema: meResponseSchema, signal: controller.signal });
        setPhase({ kind: "ready" });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase(isSignedOut(error) ? { kind: "signed_out" } : { kind: "error", error });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [attempt]);

  const accept = useCallback(() => {
    if (!token) return;
    setAccepting(true);
    api("/invites/accept", { method: "POST", body: { token }, schema: orgResponseSchema })
      .then((org) => {
        // Single use: the token is spent, so it must not linger in the tab.
        clearStoredInviteToken();
        toast({ tone: "success", title: t("invite.accepted", { org: org.name }) });
        router.replace("/dashboard");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
          clearStoredInviteToken();
          setPhase({ kind: "not_found" });
        } else if (errorReason(error) === "already_member") {
          clearStoredInviteToken();
          setPhase({ kind: "already_member" });
        } else if (isSignedOut(error)) {
          setPhase({ kind: "signed_out" });
        } else {
          setPhase({ kind: "error", error });
        }
        setAccepting(false);
      });
  }, [router, toast, token]);

  switch (phase.kind) {
    case "checking":
      return (
        <div role="status" className="flex items-center gap-3 text-text-muted">
          <Spinner decorative />
          {t("invite.checking")}
        </div>
      );
    case "missing":
      return (
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-xl font-semibold text-text">
            {t("invite.missing.title")}
          </h2>
          <p className="text-base text-text-muted">{t("invite.missing.body")}</p>
        </div>
      );
    case "signed_out":
      return (
        <div className="flex flex-col gap-5">
          <p className="text-base text-text">{t("invite.signedOut.body")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/login?next=${encodeURIComponent("/invite")}`}
              className={buttonStyles({ size: "lg", className: "flex-1" })}
            >
              {t("invite.signedOut.signIn")}
            </Link>
            <Link
              href={`/register?next=${encodeURIComponent("/invite")}`}
              className={buttonStyles({ variant: "secondary", size: "lg", className: "flex-1" })}
            >
              {t("invite.signedOut.register")}
            </Link>
          </div>
        </div>
      );
    case "ready":
      return (
        <div className="flex flex-col gap-5">
          <p className="text-base text-text">{t("invite.ready.body")}</p>
          <Button size="lg" name="accept-invite" loading={accepting} onClick={accept}>
            {t("invite.accept")}
          </Button>
        </div>
      );
    case "not_found":
      return (
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-xl font-semibold text-text">
            {t("invite.notFound.title")}
          </h2>
          <p className="text-base text-text">{t("invite.notFound.body")}</p>
          <Notice>{t("invite.notFound.hint")}</Notice>
          <Link href="/dashboard" className={buttonStyles({ variant: "secondary" })}>
            {t("invite.toDashboard")}
          </Link>
        </div>
      );
    case "already_member":
      return (
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-xl font-semibold text-text">
            {t("invite.alreadyMember.title")}
          </h2>
          <Notice tone="success">{t("invite.alreadyMember.body")}</Notice>
          <Link href="/dashboard" className={buttonStyles({ size: "lg" })}>
            {t("invite.toDashboard")}
          </Link>
        </div>
      );
    case "error":
      return (
        <ErrorNotice
          error={phase.error}
          onRetry={() => {
            setPhase({ kind: "checking" });
            setAttempt((current) => current + 1);
          }}
        />
      );
  }
}
