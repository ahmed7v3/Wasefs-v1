import { t } from "@wasfa/shared/i18n";

import { formatRelativeTime } from "../admin-format";

import type { AutosaveStatus } from "./autosave";

/**
 * The visible autosave sentence. Under a minute it counts seconds («تم الحفظ قبل 12 ثوانٍ»); after that it
 * switches to the relative form. Empty when nothing has happened yet and there is nothing unsaved.
 */
export function autosaveLabel(status: AutosaveStatus, dirty: boolean, now: number): string {
  switch (status.kind) {
    case "saving":
      return t("admin.editor.autosave.saving");
    case "error":
      return t("admin.editor.autosave.failed");
    case "saved": {
      const seconds = Math.max(0, Math.round((now - status.at) / 1_000));
      if (seconds < 5) return t("admin.editor.autosave.justNow");
      if (seconds < 60) return t("admin.editor.autosave.seconds", { n: seconds });
      return t("admin.editor.autosave.ago", { ago: formatRelativeTime(new Date(status.at), now) });
    }
    case "idle":
      return dirty ? t("admin.editor.autosave.pending") : "";
  }
}
