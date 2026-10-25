"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { CircleCheck, Info, OctagonX, TriangleAlert } from "lucide-react";

import { tOr } from "../../../lib/admin-format";

import type { QualityGate } from "@wasfa/shared/schemas/content";

/** Message of a gate: Admin-1's `admin.content.gate.<id>` when defined, else the editor's own. */
export function gateMessage(gate: Pick<QualityGate, "id" | "params">): string {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(gate.params)) params[key] = String(value);
  const own = t(`admin.editor.gate.${gate.id}` as MessageKey, params);
  return tOr(`admin.content.gate.${gate.id}`, own, params);
}

function GateIcon({ gate }: { gate: QualityGate }) {
  if (gate.ok) return <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />;
  if (gate.level === "block")
    return <OctagonX aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />;
  if (gate.level === "warn")
    return <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />;
  return <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-text-muted" />;
}

function gateStatus(gate: QualityGate): MessageKey {
  if (gate.ok) return "admin.editor.gate.status.ok";
  if (gate.level === "block") return "admin.editor.gate.status.block";
  if (gate.level === "warn") return "admin.editor.gate.status.warn";
  return "admin.editor.gate.status.info";
}

/**
 * The quality gates of the last evaluation: an icon AND a word for each state (never colour alone),
 * then the one-line rule with its numbers. Blocking failures sort first.
 */
export function GateList({ gates }: { gates: readonly QualityGate[] }) {
  if (gates.length === 0) {
    return <p className="text-base text-text-muted">{t("admin.editor.gates.empty")}</p>;
  }
  const rank = (gate: QualityGate): number =>
    gate.ok ? 3 : gate.level === "block" ? 0 : gate.level === "warn" ? 1 : 2;
  const sorted = [...gates].sort((a, b) => rank(a) - rank(b));
  return (
    <ul className="flex flex-col gap-2" aria-label={t("admin.editor.gates.title")}>
      {sorted.map((gate) => (
        <li key={gate.id} className="flex items-start gap-2" data-gate={gate.id} data-ok={gate.ok}>
          <GateIcon gate={gate} />
          <span className="min-w-0 text-base text-text">
            <span className="font-semibold">{t(gateStatus(gate))}</span>
            {": "}
            {gateMessage(gate)}
          </span>
        </li>
      ))}
    </ul>
  );
}
