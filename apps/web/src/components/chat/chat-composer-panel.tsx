"use client";

import { t } from "@wasfa/shared/i18n";
import { Composer } from "@wasfa/ui";
import Link from "next/link";

import type { ChatComposerState } from "../../lib/use-chat-composer";
import type { ReactNode } from "react";

export interface ChatComposerPanelProps {
  composer: ChatComposerState;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  /** Skill chips shown under the composer. */
  chips?: ReactNode;
  autoFocus?: boolean | undefined;
  disabled?: boolean | undefined;
}

/** The shared composer of `/ai` and `/ai/<id>`, bound to the composer state and the plan's capabilities. */
export function ChatComposerPanel({
  composer,
  streaming,
  onSend,
  onStop,
  chips,
  autoFocus,
  disabled,
}: ChatComposerPanelProps) {
  const { capabilities, attachments } = composer;
  const rxHint =
    attachments.count > 0 ? (
      <p className="m-0">
        {t("chat.composer.rxSuggestion")}{" "}
        <Link href="/analyze" className="font-semibold text-primary underline underline-offset-2">
          {t("chat.composer.rxSuggestionAction")}
        </Link>
      </p>
    ) : null;
  return (
    <div className="flex flex-col gap-3">
      <Composer
        value={composer.text}
        onChange={composer.setText}
        onSubmit={onSend}
        streaming={streaming}
        onStop={onStop}
        mode={composer.mode}
        onModeChange={composer.setMode}
        allowedModes={capabilities.modes}
        search={composer.search}
        onSearchChange={composer.setSearch}
        searchAllowed={capabilities.webSearch}
        uploader={attachments.uploader}
        onPagesChange={attachments.onPagesChange}
        captureResetKey={attachments.resetKey}
        estimate={t("chat.composer.estimate", {
          balance: capabilities.balance === null ? "—" : String(capabilities.balance),
        })}
        notice={rxHint}
        autoFocus={autoFocus}
        disabled={disabled}
      />
      {chips}
    </div>
  );
}
