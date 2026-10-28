"use client";

import { t } from "@wasfa/shared/i18n";
import { RX_LEGIBILITIES } from "@wasfa/shared/rx";
import {
  drugSandboxResponseSchema,
  type DrugSandboxResponse,
} from "@wasfa/shared/schemas/admin-drugs";
import { Badge, Button, Card, CardTitle, Field, Input, Select } from "@wasfa/ui";
import { FlaskConical } from "lucide-react";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { MATCH_TONES, scorePercent } from "../../lib/drug-admin";
import { buildQuery } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { DataTable, type DataTableColumn } from "./data-table";

type Candidate = DrugSandboxResponse["candidates"][number];
type Legibility = (typeof RX_LEGIBILITIES)[number];

function ScoreBar({ score }: { score: number }) {
  const percent = Number(scorePercent(score));
  return (
    <span className="flex items-center gap-2">
      <span
        role="meter"
        aria-label={t("admin.drugs.sandbox.score")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="block h-2 w-24 overflow-hidden rounded-full bg-neutral-200"
      >
        <span className="block h-full bg-primary" style={{ inlineSize: `${String(percent)}%` }} />
      </span>
      <bdi dir="ltr" className="tabular-nums">
        {t("admin.drugs.match.score", { score: percent })}
      </bdi>
    </span>
  );
}

/**
 * "What would the engine do with this name?": runs the matcher and the decision rule on the SAVED
 * settings, so a threshold is tuned by saving it above and trying a few real names here.
 */
export function DrugSandboxPanel() {
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("");
  const [form, setForm] = useState("");
  const [legibility, setLegibility] = useState<Legibility>("clear");
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [result, setResult] = useState<DrugSandboxResponse | null>(null);

  const run = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running || name.trim() === "") return;
    setRunning(true);
    setFailure(null);
    api(
      `/admin/drugs/sandbox?${buildQuery({
        q: name.trim(),
        strength: strength.trim(),
        form: form.trim(),
        legibility,
      })}`,
      { schema: drugSandboxResponseSchema },
    ).then(
      (data) => {
        setRunning(false);
        setResult(data);
      },
      (error: unknown) => {
        setRunning(false);
        setFailure(error);
      },
    );
  };

  const columns: DataTableColumn<Candidate>[] = [
    {
      id: "drug",
      header: t("admin.drugs.col.name"),
      primary: true,
      cell: (candidate) => (
        <span className="flex flex-col items-start gap-0.5">
          <bdi dir="ltr">{candidate.brandEn}</bdi>
          {candidate.brandAr ? (
            <span className="text-sm font-normal text-text-muted">{candidate.brandAr}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "score",
      header: t("admin.drugs.sandbox.score"),
      cell: (candidate) => <ScoreBar score={candidate.score} />,
    },
    {
      id: "matchedOn",
      header: t("admin.drugs.sandbox.matchedOn"),
      cell: (candidate) => t(`admin.drugs.matchedOn.${candidate.explanation.matchedOn}`),
    },
    {
      id: "strength",
      header: t("admin.drugs.col.strength"),
      cell: (candidate) => (
        <span className="flex flex-col items-start gap-0.5">
          {candidate.strengthText ? <bdi dir="ltr">{candidate.strengthText}</bdi> : "—"}
          <span className="text-sm font-normal text-text-muted">
            {t(`admin.drugs.strengthState.${candidate.explanation.strength}`)}
          </span>
        </span>
      ),
    },
    {
      id: "form",
      header: t("admin.drugs.col.form"),
      cell: (candidate) => (
        <span className="flex flex-col items-start gap-0.5">
          {candidate.form ?? "—"}
          <span className="text-sm font-normal text-text-muted">
            {t(`admin.drugs.formState.${candidate.explanation.form}`)}
          </span>
        </span>
      ),
    },
    {
      id: "family",
      header: t("admin.drugs.sandbox.family"),
      cell: (candidate) =>
        candidate.brandKey === "" ? "—" : <bdi dir="ltr">{candidate.brandKey}</bdi>,
    },
  ];

  const chosenId = result?.decision.chosenDrugId ?? null;
  const chosen = result?.candidates.find((candidate) => candidate.drugId === chosenId);

  return (
    <section aria-labelledby="sandbox-title" className="flex scroll-mt-24 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="sandbox-title" className="text-xl font-semibold text-text">
          {t("admin.drugs.sandbox.title")}
        </h2>
        <p className="text-sm text-text-muted">{t("admin.drugs.sandbox.lead")}</p>
      </div>
      <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
        <form
          onSubmit={run}
          noValidate
          aria-label={t("admin.drugs.sandbox.title")}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label={t("admin.drugs.sandbox.name")} className="lg:col-span-2">
            {(control) => (
              <Input
                {...control}
                name="sandbox-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t("admin.drugs.filter.strength")}>
            {(control) => (
              <Input
                {...control}
                name="sandbox-strength"
                ltr
                placeholder={t("admin.drugs.filter.strengthHint")}
                value={strength}
                onChange={(event) => {
                  setStrength(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t("admin.drugs.filter.form")}>
            {(control) => (
              <Input
                {...control}
                name="sandbox-form"
                placeholder={t("admin.drugs.filter.formHint")}
                value={form}
                onChange={(event) => {
                  setForm(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label={t("admin.drugs.sandbox.legibility")} className="sm:col-span-1">
            {(control) => (
              <Select
                {...control}
                name="sandbox-legibility"
                value={legibility}
                onChange={(event) => {
                  setLegibility(event.target.value as Legibility);
                }}
              >
                {RX_LEGIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.drugs.sandbox.legibility.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={running} disabled={name.trim() === ""}>
              <FlaskConical aria-hidden className="size-5" />
              {t("admin.drugs.sandbox.run")}
            </Button>
          </div>
        </form>
        {failure ? <ErrorNotice error={failure} /> : null}
      </Card>

      {result ? (
        <div className="flex flex-col gap-4" aria-live="polite">
          {!result.settings.enabled || result.settings.mode === "ai_only" ? (
            <Notice tone="warning">{t("admin.drugs.sandbox.engineOff")}</Notice>
          ) : null}
          <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>{t("admin.drugs.sandbox.decision")}</CardTitle>
              <Badge tone={MATCH_TONES[result.decision.matchClass]}>
                {t(`admin.drugs.sandbox.class.${result.decision.matchClass}`)}
              </Badge>
            </div>
            <p className="text-base text-text">
              {t(`admin.drugs.sandbox.reason.${result.decision.reason}`, {
                accept: scorePercent(result.settings.acceptScore),
                review: scorePercent(result.settings.reviewScore),
                margin: scorePercent(result.settings.minMargin),
              })}
            </p>
            {chosen ? (
              <p className="text-base text-text">
                {t("admin.drugs.sandbox.chosen")}{" "}
                <bdi dir="ltr" className="font-semibold">
                  {chosen.brandEn}
                </bdi>
              </p>
            ) : null}
            {result.decision.familyOnly ? (
              <p className="text-sm text-text-muted">{t("admin.drugs.sandbox.familyOnly")}</p>
            ) : null}
          </Card>
          <DataTable
            caption={t("admin.drugs.sandbox.candidates")}
            columns={columns}
            rows={result.candidates}
            rowKey={(candidate) => candidate.drugId}
            status="ready"
            emptyTitle={t("admin.drugs.sandbox.noCandidates")}
          />
        </div>
      ) : null}
    </section>
  );
}
