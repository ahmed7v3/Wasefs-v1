"use client";

import { t } from "@wasfa/shared/i18n";
import { CHAT_MAX_IMAGES, CHAT_MESSAGE_MAX_CHARS } from "@wasfa/shared/schemas/chat";
import { Globe, Info, Plus, Send, Square, X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { cn } from "../cn";
import { Spinner } from "../spinner";

import { ModeToggle } from "./ModeToggle";

import type { AiMode } from "@wasfa/shared/ai";
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from "react";

export interface ComposerAttachment {
  id: string;
  name: string;
  status: "uploading" | "ready" | "error";
  /** Local preview (`blob:` URL) of the picture. */
  previewUrl?: string | undefined;
}

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
  attachments: readonly ComposerAttachment[];
  /** Pasted, dropped or picked pictures; the owner uploads them and reports back in `attachments`. */
  onFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /** How the cost is worked out, shown on hover/focus of the info button. */
  estimate: string;
  /** Something to tell about the composer (an upload error, the prescription suggestion). */
  notice?: ReactNode;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
}

const MAX_LINES = 8;
const ACCEPT = "image/jpeg,image/png,image/webp";

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

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
  attachments,
  onFiles,
  onRemoveAttachment,
  estimate,
  notice,
  disabled = false,
  autoFocus = false,
  className,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const labelId = useId();
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
  const uploading = attachments.some((item) => item.status === "uploading");
  const canSend = value.trim() !== "" && !tooLong && !uploading && !disabled;
  const atLimit = attachments.length >= CHAT_MAX_IMAGES;

  const submit = () => {
    if (canSend && !streaming) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSubmitKey(event)) return;
    event.preventDefault();
    submit();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(event.clipboardData.files);
    if (files.length === 0) return;
    // A picture was pasted: attach it and keep any text in the clipboard out of the way.
    event.preventDefault();
    onFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDragging(false);
    const files = imageFiles(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    onFiles(files);
  };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border bg-surface p-3 shadow-card transition-colors duration-150",
        dragging ? "border-primary bg-primary-soft" : "border-border",
        className,
      )}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging ? (
        <p className="pointer-events-none text-center text-sm font-semibold text-primary">
          {t("chat.composer.dropHere")}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <ul aria-label={t("chat.composer.attachments")} className="flex flex-wrap gap-2">
          {attachments.map((item) => (
            <li
              key={item.id}
              className={cn(
                "relative flex size-16 items-center justify-center overflow-hidden rounded-md border bg-neutral-100",
                item.status === "error" ? "border-danger" : "border-border",
              )}
            >
              {item.previewUrl ? (
                // A local blob preview of the user's own picture: nothing to optimize or proxy.
                <img src={item.previewUrl} alt={item.name} className="size-full object-cover" />
              ) : null}
              {item.status === "uploading" ? (
                <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
                  <Spinner />
                  <span className="sr-only">{t("chat.composer.uploading")}</span>
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  onRemoveAttachment(item.id);
                }}
                aria-label={`${t("chat.composer.removeAttachment")}: ${item.name}`}
                className="absolute end-0 top-0 inline-flex size-6 items-center justify-center rounded-full bg-neutral-900/70 text-on-primary hover:bg-neutral-900 focus-visible:outline-none focus-visible:shadow-focus"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

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
        onPaste={onPaste}
        className="max-h-none min-h-11 w-full resize-none bg-transparent px-2 py-2 text-base leading-8 text-text placeholder:text-text-muted focus-visible:outline-none"
      />
      <p id={hintId} className="px-2 text-xs text-text-muted">
        {tooLong
          ? t("chat.composer.tooLong", { max: CHAT_MESSAGE_MAX_CHARS })
          : value.length > CHAT_MESSAGE_MAX_CHARS * 0.8
            ? t("chat.composer.counter", { count: value.length, max: CHAT_MESSAGE_MAX_CHARS })
            : t("chat.composer.hint")}
      </p>
      {notice ? <div className="px-2 text-sm text-text-muted">{notice}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = imageFiles(event.target.files);
            event.target.value = "";
            if (files.length > 0) onFiles(files);
          }}
        />
        <button
          type="button"
          disabled={disabled || atLimit}
          title={atLimit ? t("chat.composer.tooMany", { max: CHAT_MAX_IMAGES }) : undefined}
          aria-label={t("chat.composer.attach")}
          onClick={() => fileInputRef.current?.click()}
          className={iconButton}
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
