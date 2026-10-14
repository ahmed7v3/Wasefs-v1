"use client";

import { t } from "@wasfa/shared/i18n";
import { CHAT_MAX_IMAGES, CHAT_MESSAGE_MAX_CHARS } from "@wasfa/shared/schemas/chat";
import { Globe, Info, Plus, Send, Square } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { CaptureSurface } from "../capture/CaptureSurface";
import { cn } from "../cn";

import { ModeToggle } from "./ModeToggle";

import type { CapturePage, CaptureUploader } from "../capture/types";
import type { AiMode } from "@wasfa/shared/ai";
import type { KeyboardEvent, ReactNode } from "react";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter (without Shift, outside an IME composition) or the send button. */
  onSubmit: () => void;
  /** An answer is streaming: the send button becomes stop. */
  streaming: boolean;
  onStop: () => void;
  mode: AiMode;
  onModeChange: (mode: AiMode) => void;
  /** Modes the plan allows. */
  allowedModes: readonly AiMode[];
  search: boolean;
  onSearchChange: (search: boolean) => void;
  /** The plan includes web search; otherwise the toggle shows as locked. */
  searchAllowed: boolean;
  /**
   * Pictures go through the shared `CaptureSurface` (paste, drop and pick all end there). The owner
   * injects the browser-side `uploader` and learns the pages through `onPagesChange`; the message
   * may carry the `fileId` of every page that is `uploaded`.
   */
  uploader: CaptureUploader;
  onPagesChange: (pages: CapturePage[]) => void;
  /** Change it to forget the pages (after a send): the surface is mounted afresh. */
  captureResetKey?: number | undefined;
  /** How the cost is worked out, shown on hover/focus of the info button. */
  estimate: string;
  /** Something to tell about the composer (an upload error, the prescription suggestion). */
  notice?: ReactNode;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
}

const MAX_LINES = 8;

/** What a keydown means for the composer. Pure, so the IME rules are testable on their own. */
export function isSubmitKey(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  // The Enter that confirms an IME candidate (Arabic, Chinese, ...) is not a send. Safari reports
  // it after `compositionend` with `isComposing` already false, but with keyCode 229.
  return event.nativeEvent?.isComposing !== true && event.keyCode !== 229;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  streaming,
  onStop,
  mode,
  onModeChange,
  allowedModes,
  search,
  onSearchChange,
  searchAllowed,
  uploader,
  onPagesChange,
  captureResetKey = 0,
  estimate,
  notice,
  disabled = false,
  autoFocus = false,
  className,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pages, setPages] = useState<CapturePage[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const labelId = useId();
  const captureId = useId();
  const hintId = useId();
  const estimateId = useId();

  // Grow with the text up to eight lines, then scroll inside.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || 32;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const max = lineHeight * MAX_LINES + (Number.isNaN(padding) ? 0 : padding);
    element.style.height = `${Math.min(element.scrollHeight, max)}px`;
    element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden";
  }, [value]);

  const tooLong = value.length > CHAT_MESSAGE_MAX_CHARS;
  // A page still travelling, waiting for a quality decision or failed would silently drop out of
  // the message: the person settles it first (the tray offers retry, retake and remove).
  const waiting = pages.some((page) => page.status === "processing" || page.status === "uploading");
  const unsettled = pages.some((page) => page.status === "warning" || page.status === "error");
  const canSend = value.trim() !== "" && !tooLong && !waiting && !unsettled && !disabled;
  // Pasted or dropped pictures open the panel by themselves; the plus button opens it for picking.
  const showCapture = captureOpen || pages.length > 0;

  const submit = () => {
    if (canSend && !streaming) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitKey(event)) return;
    event.preventDefault();
    submit();
  };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-card",
        className,
      )}
    >
      {/* Mounted for good (its paste and drop listeners must always be there); `collapsed` keeps it empty until opened. The negative margin takes back the gap of a zero-height row. */}
      <div id={captureId} className={cn(!showCapture && "-mb-2")}>
        <CaptureSurface
          key={captureResetKey}
          variant="composer"
          collapsed={!captureOpen}
          maxPages={CHAT_MAX_IMAGES}
          uploader={uploader}
          disabled={disabled}
          onPagesChange={(next) => {
            setPages(next);
            onPagesChange(next);
          }}
        />
      </div>

      <label id={labelId} htmlFor={`${labelId}-input`} className="sr-only">
        {t("chat.composer.label")}
      </label>
      <textarea
        id={`${labelId}-input`}
        ref={textareaRef}
        value={value}
        rows={1}
        autoFocus={autoFocus}
        placeholder={t("chat.composer.placeholder")}
        aria-describedby={hintId}
        aria-invalid={tooLong || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        className="max-h-none min-h-11 w-full resize-none bg-transparent px-2 py-2 text-base leading-8 text-text placeholder:text-text-muted focus-visible:outline-none"
      />
      <p id={hintId} className="px-2 text-xs text-text-muted">
        {tooLong
          ? t("chat.composer.tooLong", { max: CHAT_MESSAGE_MAX_CHARS })
          : value.length > CHAT_MESSAGE_MAX_CHARS * 0.8
            ? t("chat.composer.counter", { count: value.length, max: CHAT_MESSAGE_MAX_CHARS })
            : waiting
              ? t("chat.composer.waitUploads")
              : unsettled
                ? t("chat.composer.fixPages")
                : t("chat.composer.hint")}
      </p>
      {notice ? <div className="px-2 text-sm text-text-muted">{notice}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t("chat.composer.attach")}
          aria-expanded={showCapture}
          aria-controls={captureId}
          onClick={() => {
            // With pictures on screen the panel stays; the button then only opens it while empty.
            setCaptureOpen((open) => !open);
          }}
          className={cn(iconButton, showCapture && "bg-primary-soft text-primary")}
        >
          <Plus aria-hidden className="size-5" />
        </button>
        <button
          type="button"
          aria-pressed={search}
          disabled={disabled || !searchAllowed}
          aria-label={searchAllowed ? t("chat.search.label") : t("chat.search.locked")}
          title={searchAllowed ? t("chat.search.label") : t("chat.search.locked")}
          onClick={() => {
            onSearchChange(!search);
          }}
          className={cn(iconButton, search && "bg-primary-soft text-primary")}
        >
          <Globe aria-hidden className="size-5" />
        </button>
        <span className="group relative">
          <button
            type="button"
            aria-label={t("chat.composer.estimateLabel")}
            aria-describedby={estimateId}
            className={iconButton}
          >
            <Info aria-hidden className="size-5" />
          </button>
          <span
            id={estimateId}
            role="tooltip"
            className="pointer-events-none invisible absolute bottom-full start-0 z-10 mb-2 w-64 rounded-md bg-neutral-900 p-3 text-xs leading-6 text-on-primary opacity-0 shadow-raised transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
          >
            {estimate}
          </span>
        </span>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <ModeToggle
            value={mode}
            onChange={onModeChange}
            allowed={allowedModes}
            disabled={disabled}
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t("chat.composer.stop")}
              className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Square aria-hidden className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={t("chat.composer.send")}
              className="inline-flex size-11 items-center justify-center rounded-full bg-primary text-on-primary transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              {/* The paper plane points at the end of the line, so it mirrors in RTL (DESIGN-SYSTEM §4.4). */}
              <Send aria-hidden className="size-5 rtl:-scale-x-100" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-full text-text-muted transition-colors duration-150 " +
  "hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus " +
  "disabled:cursor-not-allowed disabled:opacity-50";
