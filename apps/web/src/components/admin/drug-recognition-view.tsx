"use client";

import { t } from "@wasfa/shared/i18n";

import { Notice } from "../notice";

import { DrugSandboxPanel } from "./drug-sandbox-panel";
import { SettingsView } from "./settings-view";

export interface DrugRecognitionViewProps {
  canReadSettings: boolean;
  canWriteSettings: boolean;
}

/**
 * `/admin/drugs/recognition` (docs/MEDICATIONS.md section 7): the `medications` settings first, the
 * two switches on top, then the sandbox that tries a name against the saved values.
 */
export function DrugRecognitionView({
  canReadSettings,
  canWriteSettings,
}: DrugRecognitionViewProps) {
  return (
    <div className="flex flex-col gap-10">
      {canReadSettings ? (
        <SettingsView canWrite={canWriteSettings} keys={["medications"]} />
      ) : (
        <Notice tone="info">{t("admin.drugs.recognition.noSettings")}</Notice>
      )}
      <DrugSandboxPanel />
    </div>
  );
}
