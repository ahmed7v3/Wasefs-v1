"use client";

import { t } from "@wasfa/shared/i18n";
import { Button } from "@wasfa/ui";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

import { ActionMenu, type MenuEntry } from "./action-menu";
import { AutosaveIndicator } from "./autosave-indicator";
import {
  EditorLiveBadge,
  EditorStatusBadge,
  UnpublishedChangesBadge,
  UnsavedBadge,
} from "./status-badges";

import type { PrimaryAction } from "../../../lib/content-editor/actions";
import type { AutosaveStatus } from "../../../lib/content-editor/autosave";
import type { ContentStatus } from "@wasfa/shared/content/constants";

export interface TopBarProps {
  status: ContentStatus | null;
  live: boolean;
  hasUnpublishedChanges: boolean;
  dirty: boolean;
  autosave: AutosaveStatus;
  primary: PrimaryAction;
  primaryBusy: boolean;
  /** The primary action cannot run (nothing to save, no permission, title missing). */
  primaryDisabled: boolean;
  previewOpen: boolean;
  menu: readonly MenuEntry[];
  onPrimary: () => void;
  onTogglePreview: () => void;
}

/**
 * Sticky under the admin header: status chip, live / unpublished-changes / unsaved badges, the autosave
 * state, then Preview, the one primary button and the overflow menu. At 320 px the badges wrap onto their
 * own row and the three controls stay on one (44 px each); nothing here depends on hover.
 */
export function TopBar({
  status,
  live,
  hasUnpublishedChanges,
  dirty,
  autosave,
  primary,
  primaryBusy,
  primaryDisabled,
  previewOpen,
  menu,
  onPrimary,
  onTogglePreview,
}: TopBarProps) {
  const PreviewIcon = previewOpen ? EyeOff : Eye;
  return (
    <div className="sticky top-16 z-10 -mx-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-bg px-4 py-2 sm:-mx-6 sm:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Link
          href="/admin/content"
          aria-label={t("admin.editor.back")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
        >
          <ArrowRight aria-hidden className="size-5 ltr:rotate-180" />
        </Link>
        {status ? <EditorStatusBadge status={status} /> : null}
        {live ? <EditorLiveBadge /> : null}
        {hasUnpublishedChanges ? <UnpublishedChangesBadge /> : null}
        {dirty ? <UnsavedBadge /> : null}
        <AutosaveIndicator status={autosave} dirty={dirty} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          aria-pressed={previewOpen}
          onClick={onTogglePreview}
          aria-label={t("admin.editor.bar.preview")}
          className="px-3 sm:px-5"
        >
          <PreviewIcon aria-hidden className="size-5" />
          <span className="hidden sm:inline">{t("admin.editor.bar.preview")}</span>
        </Button>
        <Button
          loading={primaryBusy}
          disabled={primaryDisabled}
          onClick={onPrimary}
          data-testid="primary-action"
        >
          {t(primary.label)}
        </Button>
        <ActionMenu label={t("admin.editor.menu.label")} entries={menu} />
      </div>
    </div>
  );
}
