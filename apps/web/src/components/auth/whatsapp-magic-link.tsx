"use client";

import { t } from "@wasfa/shared/i18n";
import { waLoginStatusResponseSchema } from "@wasfa/shared/schemas/wa-login";
import { Spinner, buttonStyles } from "@wasfa/ui";
import { MessageCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { magicTokenFromHash, signedInTarget } from "../../lib/whatsapp-login";

type State = "working" | "invalid";

/**
 * Redeems the agent's one-time link. The token is in the URL fragment: it is read once, removed from
 * the address bar before anything else happens, and sent in a POST body (never a URL). Whatever goes
 * wrong, the person sees the same "invalid or expired" page.
 */
export function WhatsAppMagicLink() {
  const router = useRouter();
  const [state, setState] = useState<State>("working");
  // The token works once: React's double effect in development must not spend it twice.
  const attempt = useRef<Promise<State> | null>(null);

  useEffect(() => {
    attempt.current ??= (async (): Promise<State> => {
      const token = magicTokenFromHash(window.location.hash);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      if (token === null) return "invalid";
      try {
        const answer = await api("/auth/whatsapp/magic", {
          method: "POST",
          body: { token },
          schema: waLoginStatusResponseSchema,
        });
        if (answer.status !== "signed_in") return "invalid";
        router.replace(signedInTarget("/dashboard", answer.isNew));
        router.refresh();
        return "working";
      } catch {
        return "invalid";
      }
    })();
    void attempt.current.then(setState);
  }, [router]);

  if (state === "working") {
    return (
      <div role="status" className="flex items-center gap-3 text-base text-text-muted">
        <Spinner decorative />
        {t("auth.whatsapp.link.working")}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4" role="alert">
      <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-4">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
        <p className="text-base text-text">{t("auth.whatsapp.link.invalid")}</p>
      </div>
      <Link href="/login" className={buttonStyles({ size: "lg", className: "w-full" })}>
        <MessageCircle aria-hidden className="size-5" />
        {t("auth.whatsapp.button")}
      </Link>
    </div>
  );
}
