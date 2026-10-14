"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  skillsResponseSchema,
  type SkillView,
  type SkillsResponse,
} from "@wasfa/shared/schemas/admin-ai";
import { Badge, Button, Card, CardTitle, Checkbox, Skeleton, useToast } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";

interface SkillCardProps {
  skill: SkillView;
  plans: SkillsResponse["plans"];
  canWrite: boolean;
  onSave: (skill: SkillView, enabledFor: "all" | string[]) => Promise<void>;
}

function SkillCard({ skill, plans, canWrite, onSave }: SkillCardProps) {
  const [all, setAll] = useState(skill.enabledFor === "all");
  const [keys, setKeys] = useState<string[]>(skill.enabledFor === "all" ? [] : skill.enabledFor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const editable = canWrite && skill.chat;

  const save = () => {
    setSaving(true);
    setError(null);
    onSave(skill, all ? "all" : keys).then(
      () => {
        setSaving(false);
      },
      (failure: unknown) => {
        setSaving(false);
        setError(toApiError(failure));
      },
    );
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          <span dir="ltr">{skill.name}</span>
        </CardTitle>
        <Badge tone="neutral">
          {t("admin.ai.skills.version")}: <span dir="ltr">{skill.version}</span>
        </Badge>
      </div>
      <p className="text-sm text-text-muted" dir="auto">
        {skill.description}
      </p>
      <p className="text-sm">
        {t("admin.ai.skills.tasks")}:{" "}
        {skill.tasks.map((task) => t(`admin.ai.task.${task}` as MessageKey)).join("، ")}
      </p>
      {skill.chat ? (
        <fieldset className="flex flex-col gap-1" disabled={!editable}>
          <legend className="sr-only">{t("admin.ai.skills.plans", { name: skill.name })}</legend>
          <Checkbox
            name={`all-${skill.name}`}
            label={t("admin.ai.skills.allToggle")}
            checked={all}
            disabled={!editable}
            onChange={(event) => {
              setAll(event.target.checked);
            }}
          />
          {all
            ? null
            : plans.map((plan) => (
                <Checkbox
                  key={plan.key}
                  name={`${skill.name}-${plan.key}`}
                  label={plan.nameAr}
                  checked={keys.includes(plan.key)}
                  disabled={!editable}
                  onChange={(event) => {
                    setKeys((current) =>
                      event.target.checked
                        ? [...current, plan.key]
                        : current.filter((key) => key !== plan.key),
                    );
                  }}
                />
              ))}
          {!all && keys.length === 0 ? (
            <p className="text-sm text-warning">{t("admin.ai.skills.off")}</p>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-sm text-text-muted">{t("admin.ai.skills.notChat")}</p>
      )}
      {error ? <ErrorNotice error={error} /> : null}
      {editable ? (
        <div className="flex justify-end">
          <Button type="button" name={`save-${skill.name}`} loading={saving} onClick={save}>
            {t("admin.ai.skills.save")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Skills with version and per-plan enablement (Task 2.4); the write needs a fresh password check. */
export function AiSkillsView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/ai/skills", skillsResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [saved, setSaved] = useState<SkillsResponse | null>(null);

  if (resource.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  const data = saved ?? resource.data;

  const save = async (skill: SkillView, enabledFor: "all" | string[]) => {
    const response = await reauth.run(() =>
      api(`/admin/ai/skills/${skill.name}`, {
        method: "PUT",
        body: { enabledFor },
        schema: skillsResponseSchema,
      }),
    );
    setSaved(response);
    toast({ tone: "success", title: t("admin.ai.skills.saved") });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">
        {canWrite ? t("admin.ai.skills.lead") : t("admin.ai.skills.noWrite")}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.items.map((skill) => (
          <SkillCard
            key={`${skill.name}:${skill.version}:${JSON.stringify(skill.enabledFor)}`}
            skill={skill}
            plans={data.plans}
            canWrite={canWrite}
            onSave={save}
          />
        ))}
      </div>
    </div>
  );
}
