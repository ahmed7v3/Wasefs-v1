"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Field, Select, useToast } from "@wasfa/ui";
import { Download } from "lucide-react";
import { useState } from "react";

import { downloadCsv } from "../../lib/csv-download";
import { monthLabel, recentMonths } from "../../lib/org-format";
import { errorMessage } from "../error-notice";

export interface UsageExportProps {
  orgId: string;
  /** The month the dashboard shows (`YYYY-MM`); the picker offers it and the eleven before it. */
  currentMonth: string;
}

/** «تنزيل الاستخدام CSV»: one row per member for the chosen month. */
export function UsageExport({ orgId, currentMonth }: UsageExportProps) {
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      await downloadCsv(`/orgs/${orgId}/usage.csv?month=${month}`, `wasfa-usage-${month}.csv`);
    } catch (error) {
      toast({
        tone: "error",
        title: t("org.export.failed"),
        description: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="org-export-title"
      className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface p-4 sm:p-5"
    >
      <h2 id="org-export-title" className="font-heading text-lg font-semibold text-text">
        {t("org.export.title")}
      </h2>
      <p className="text-base text-text-muted">{t("org.export.lead")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("org.export.month")} className="min-w-52">
          {(control) => (
            <Select
              {...control}
              name="month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
              }}
            >
              {recentMonths(currentMonth).map((value) => (
                <option key={value} value={value}>
                  {monthLabel(value)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          name="download-usage"
          loading={busy}
          onClick={() => {
            void download();
          }}
        >
          <Download aria-hidden className="size-4" />
          {t("org.export.download")}
        </Button>
      </div>
    </section>
  );
}
