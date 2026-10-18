"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  growthPromptResponseSchema,
  startTasteResponseSchema,
  type GrowthPrompt,
} from "@wasfa/shared/schemas/growth";
import { Button, buttonStyles } from "@wasfa/ui";
import { Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { growthSessionId, trackGrowth } from "../../lib/growth-events";
import { ErrorNotice } from "../error-notice";

import type { GrowthLockedFeature, GrowthPromptContext } from "@wasfa/shared/growth";

export interface PromptSlotProps {
  context: GrowthPromptContext;
  /** `context="result"`: the finished analysis on screen. */
  rxId?: string | undefined;
  /** `context="locked"`: the feature the person just touched. */
  feature?: GrowthLockedFeature | undefined;
  /** The workspace organization, on the dashboard. */
  orgId?: string | undefined;
}

/** The variant copy, falling back to the control text when a variant has no translation yet. */
function messageOf(prompt: GrowthPrompt): string {
  const params = Object.fromEntries(Object.entries(prompt.params).map(([key, value]) => [key, String(value)]));
  const text = t(prompt.messageKey as MessageKey, params);
  if (text !== prompt.messageKey) return text;
  return t(prompt.messageKey.replace(/\.[a-z0-9_]+$/, ".a") as MessageKey, params);
}

/**
 * One calm, closable card after a real moment of value (GROWTH-STRATEGY §4). The server decides
 * whether there is one (session cap, cooldowns, kill switch, never on a running or failed analysis);
 * this only renders it inline (never a modal), reports `shown`/`clicked`/`dismissed`, and remembers a
 * close for the rest of the tab session.
 */
export function PromptSlot({ context, rxId, feature, orgId }: PromptSlotProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState<GrowthPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const reported = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ context, sessionId: growthSessionId() });
    if (rxId) query.set("rxId", rxId);
    if (feature) query.set("feature", feature);
    if (orgId) query.set("orgId", orgId);
    api(`/me/growth/prompt?${query.toString()}`, {
      schema: growthPromptResponseSchema,
      signal: controller.signal,
    }).then(
      (answer) => {
        setPrompt(answer.prompt);
      },
      () => {
        // A prompt is never worth an error on the page.
      },
    );
    return () => {
      controller.abort();
    };
  }, [context, rxId, feature, orgId]);

  useEffect(() => {
    if (prompt === null || reported.current) return;
    reported.current = true;
    trackGrowth("prompt_shown", { kind: prompt.kind }, true);
  }, [prompt]);

  if (prompt === null) return null;

  const dismiss = () => {
    trackGrowth("prompt_dismissed", { kind: prompt.kind }, true);
    setPrompt(null);
  };

  const startTaste = async () => {
    if (!rxId) return;
    trackGrowth("prompt_clicked", { kind: prompt.kind }, true);
    setBusy(true);
    setFailure(null);
    try {
      const started = await api("/me/taste", {
        method: "POST",
        body: { rxId, requestId: crypto.randomUUID() },
        schema: startTasteResponseSchema,
      });
      router.push(`/taste/${started.grantId}`);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  };

  const cta = prompt.cta;
  return (
    <aside
      aria-label={t("growth.prompt.closeLabel")}
      className="relative flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-soft p-4 pe-12 print:hidden"
      data-testid="growth-prompt"
      data-kind={prompt.kind}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("growth.prompt.closeLabel")}
        className="absolute end-2 top-2 inline-flex size-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface focus-visible:outline-none focus-visible:shadow-focus"
      >
        <X aria-hidden className="size-5" />
      </button>
      <p className="flex items-start gap-2 text-base text-text">
        <Sparkles aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
        <span>{messageOf(prompt)}</span>
      </p>
      <div className="flex flex-wrap gap-3">
        {cta.kind === "taste" ? (
          <Button
            name="prompt-cta"
            loading={busy}
            onClick={() => {
              void startTaste();
            }}
          >
            {t("growth.cta.taste")}
          </Button>
        ) : (
          <Link
            href={cta.href ?? "/pricing"}
            className={buttonStyles()}
            data-testid="prompt-cta"
            onClick={() => {
              trackGrowth("prompt_clicked", { kind: prompt.kind }, true);
            }}
          >
            {t(`growth.cta.${cta.kind}` as MessageKey)}
          </Link>
        )}
        <Button variant="ghost" name="prompt-dismiss" onClick={dismiss}>
          {t("growth.cta.dismiss")}
        </Button>
      </div>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
    </aside>
  );
}
