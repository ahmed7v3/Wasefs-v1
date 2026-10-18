"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { tasteCompareResponseSchema, type TasteCompareItem } from "@wasfa/shared/schemas/growth";
import { rxViewSchema } from "@wasfa/shared/schemas/rx";
import { Card, Skeleton, Spinner, buttonStyles } from "@wasfa/ui";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { ErrorNotice } from "../error-notice";

import type { z } from "zod";

type Compare = z.output<typeof tasteCompareResponseSchema>;

const POLL_MS = 3_000;
const IN_FLIGHT = new Set(["queued", "processing", "verifying"]);

function badgeLabel(badge: "high" | "medium" | "low"): string {
  return t(`rx.badge.${badge}` as MessageKey);
}

function Side({ side }: { side: TasteCompareItem["before"] }) {
  if (side === null) return <span className="text-text-muted">—</span>;
  return (
    <span className="flex flex-col">
      <span className="font-semibold text-text">{side.name ?? "—"}</span>
      <span className="text-sm text-text-muted">{badgeLabel(side.badge)}</span>
    </span>
  );
}

/**
 * The taste result (GROWTH §5): the same prescription read twice, side by side, with every item
 * the Deep reading improved marked. Afterwards one calm line about the plan, no timer, no pressure.
 */
export function TasteCompare({ grantId }: { grantId: string }) {
  const [data, setData] = useState<Compare | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const load = () => {
      api(`/me/taste/${grantId}/compare`, { schema: tasteCompareResponseSchema }).then(
        (answer) => {
          if (stopped) return;
          setData(answer);
          const after = rxViewSchema.safeParse(answer.after);
          if (after.success && IN_FLIGHT.has(after.data.status)) timer = window.setTimeout(load, POLL_MS);
        },
        (error: unknown) => {
          if (!stopped) setFailure(error);
        },
      );
    };
    load();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [grantId]);

  if (failure) return <ErrorNotice error={failure} />;
  if (data === null) {
    return (
      <div role="status" aria-label={t("ui.loading")} className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const after = rxViewSchema.safeParse(data.after);
  const running = after.success && IN_FLIGHT.has(after.data.status);
  const improved = data.items.filter((item) => item.improved).length;

  return (
    <div className="flex flex-col gap-6">
      {running ? (
        <Card elevation="card" className="flex items-center gap-3" role="status">
          <Spinner />
          <span className="text-base text-text">{t("growth.taste.running")}</span>
        </Card>
      ) : (
        <>
          <p className="text-lg font-semibold text-text" data-testid="taste-summary">
            {t("growth.taste.summary", {
              improved: formatNumber(improved),
              total: formatNumber(data.items.length),
            })}
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[32rem] text-start">
              <caption className="sr-only">{t("growth.taste.title")}</caption>
              <thead className="bg-neutral-100 text-sm text-text-muted">
                <tr>
                  <th scope="col" className="p-3 text-start">#</th>
                  <th scope="col" className="p-3 text-start">{t("growth.taste.before")}</th>
                  <th scope="col" className="p-3 text-start">{t("growth.taste.deep")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.index}
                    className={item.improved ? "bg-success-soft" : "border-t border-border/60"}
                    data-improved={item.improved ? "true" : "false"}
                  >
                    <td className="p-3 align-top tabular-nums">{formatNumber(item.index + 1)}</td>
                    <td className="p-3 align-top">
                      <Side side={item.before} />
                    </td>
                    <td className="p-3 align-top">
                      <span className="flex items-start gap-2">
                        {item.improved ? (
                          <CheckCircle2 aria-label={t("growth.taste.improvedLabel")} className="mt-1 size-4 shrink-0 text-success" />
                        ) : null}
                        <Side side={item.after} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-base text-text-muted">{t("growth.taste.afterCalm")}</p>
            <Link href="/pricing" className={buttonStyles({ variant: "secondary" })}>
              {t("growth.cta.pricing")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
