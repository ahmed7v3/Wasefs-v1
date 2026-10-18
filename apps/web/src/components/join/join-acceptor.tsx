"use client";

import { t } from "@wasfa/shared/i18n";
import { joinLandingSchema } from "@wasfa/shared/schemas/org";
import { useToast } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { JOIN_COOKIE, normalizeJoinSlug } from "../../lib/attribution-cookies";
import { clearBrowserCookie, readBrowserCookie } from "../../lib/browser-cookies";
import { acceptJoin } from "../../lib/org-api";
import { errorMessage } from "../error-notice";

export interface JoinAcceptorProps {
  /** What the account has verified; joining needs both (the API enforces it, this only avoids a doomed call). */
  verified: { email: boolean; phone: boolean };
}

const HINT_KEY = "wasfa.join.hint";

/** Shows a hint once per tab session, so a person who is still verifying is not nagged on every page. */
function hintOnce(): boolean {
  try {
    if (sessionStorage.getItem(HINT_KEY) === "1") return false;
    sessionStorage.setItem(HINT_KEY, "1");
  } catch {
    /* storage blocked: the hint may repeat, which is harmless */
  }
  return true;
}

/**
 * Finishes joining an organization through `/join/<slug>`: once the account is verified, the slug
 * kept in the `wasfa_join` cookie is sent to the API a single time and the cookie is cleared. Lives
 * in the signed-in shell, so it runs on the first page after onboarding and on every later load until
 * the person has verified. Renders nothing.
 */
export function JoinAcceptor({ verified }: JoinAcceptorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const slug = normalizeJoinSlug(readBrowserCookie(JOIN_COOKIE));
    if (slug === null) {
      if (readBrowserCookie(JOIN_COOKIE) !== undefined) clearBrowserCookie(JOIN_COOKIE);
      return;
    }
    if (!verified.email || !verified.phone) {
      if (hintOnce()) {
        toast({
          tone: "info",
          title: t("join.pending.title"),
          description: t(
            !verified.email && !verified.phone
              ? "join.pending.both"
              : !verified.email
                ? "join.pending.email"
                : "join.pending.phone",
          ),
        });
      }
      return;
    }
    started.current = true;

    void (async () => {
      try {
        // The name first: a link that is used up by this very call would answer "not valid" afterwards.
        const landing = await api(`/join/${encodeURIComponent(slug)}`, {
          schema: joinLandingSchema,
        });
        const orgName = landing.valid ? landing.org.name : null;
        const result = await acceptJoin(slug);
        clearBrowserCookie(JOIN_COOKIE);
        const name = orgName ?? t("join.thisOrg");
        toast({
          tone: result.outcome === "pending" ? "info" : "success",
          title:
            result.outcome === "pending"
              ? t("join.accepted.pending", { org: name })
              : result.outcome === "already_member"
                ? t("join.accepted.already", { org: name })
                : t("join.accepted.joined", { org: name }),
        });
        router.refresh();
      } catch (error) {
        if (errorReason(error) === "verification_required") {
          toast({
            tone: "info",
            title: t("join.pending.title"),
            description: t("join.pending.both"),
          });
          started.current = false;
          return;
        }
        // A link that no longer works (or a full organization) will not work on the next load either.
        if (
          error instanceof ApiRequestError &&
          (error.code === "NOT_FOUND" || error.code === "CONFLICT")
        ) {
          clearBrowserCookie(JOIN_COOKIE);
        }
        toast({
          tone: "error",
          title: t("join.failed"),
          description:
            error instanceof ApiRequestError && error.code === "NOT_FOUND"
              ? t("join.invalid")
              : errorMessage(error),
        });
      }
    })();
  }, [router, toast, verified.email, verified.phone]);

  return null;
}
