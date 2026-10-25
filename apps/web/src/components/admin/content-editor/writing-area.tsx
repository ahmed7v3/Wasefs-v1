"use client";

import { countWords, readingMinutes } from "@wasfa/shared/content";
import { t } from "@wasfa/shared/i18n";
import { Field, cn, useToast } from "@wasfa/ui";
import { ListTree, LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type Ref,
} from "react";

import { formatNumber } from "../../../lib/admin-format";
import { htmlToMarkdown } from "../../../lib/content-editor/html-to-markdown";
import { extractHeadings, linkQueryAt } from "../../../lib/content-editor/markdown-facts";
import { commitTextState, measureOffsetTop } from "../../../lib/content-editor/textarea-edit";
import {
  applySlashCommand,
  applyToolbarAction,
  filterSlashCommands,
  insertAtCaret,
  matchSlashCommand,
  type SlashMatch,
  type TextState,
  type ToolbarAction,
  type ToolbarParams,
} from "../../../lib/content-editor/toolbar";
import { useKeyboardInset } from "../../../lib/content-editor/use-keyboard-inset";
import { MediaUploadError, uploadMedia } from "../../../lib/media-upload";
import { MediaPickerDialog } from "../media-picker-dialog";

import { FormatToolbar, TOOLBAR_LABELS } from "./format-toolbar";
import { AltPromptDialog, EntityPromptDialog } from "./prompt-dialogs";
import { SlashMenu, slashOptionId } from "./slash-menu";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";
import type { ContentPayload } from "@wasfa/shared/schemas/content";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface WritingAreaHandle {
  /** Inserts text at the caret (suggested links) and keeps the focus in the body. */
  insertText: (text: string) => void;
  focusBody: () => void;
  /** Opens the library picker for an image into the body (the Media tab's button). */
  openImagePicker: () => void;
  /** Uploads image files from the device and inserts them (alt text is asked for each). */
  addImages: (files: File[]) => void;
}

export interface WritingAreaProps {
  type: ContentType;
  locale: ContentLocale;
  payload: ContentPayload;
  onChange: (patch: Partial<ContentPayload>) => void;
  readOnly: boolean;
  /** ≥ 1024 px: the toolbar sticks under the page header; below it rides above the keyboard. */
  desktop: boolean;
  onSave: () => void;
  onBodyFocusChange: (focused: boolean) => void;
  /** What the selection / current heading is about, for the suggested links. */
  onLinkContext: (query: string) => void;
  ref?: Ref<WritingAreaHandle>;
}

const TITLE_CLASS =
  "w-full rounded-md border border-neutral-400 bg-surface px-4 py-2 font-heading text-2xl font-bold text-text " +
  "placeholder:text-text-muted hover:border-neutral-600 focus-visible:border-ring focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-60";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-400 bg-surface px-4 py-2.5 font-body text-base text-text " +
  "placeholder:text-text-muted hover:border-neutral-600 focus-visible:border-ring focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-60";

/** HTML from a code editor must stay as typed: converting it would flatten the indentation. */
const looksLikeCode = (html: string): boolean => /monospace|consolas|menlo|courier/i.test(html);

const IMAGE_BATCH_MAX = 5;

export function WritingArea({
  type,
  locale,
  payload,
  onChange,
  readOnly,
  desktop,
  onSave,
  onBodyFocusChange,
  onLinkContext,
  ref,
}: WritingAreaProps) {
  const { toast } = useToast();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const keyboard = useKeyboardInset(focused && !desktop);
  const menuId = useId();
  const bodyId = useId();

  const [slash, setSlash] = useState<{ match: SlashMatch; top: number } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const dismissedSlash = useRef<number | null>(null);

  const [entityPrompt, setEntityPrompt] = useState<"drug" | "glossary" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [altQueue, setAltQueue] = useState<MediaAsset[]>([]);
  const [uploading, setUploading] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);

  const bodyMd = payload.bodyMd;
  const words = useMemo(() => countWords(bodyMd), [bodyMd]);
  const headings = useMemo(() => extractHeadings(bodyMd), [bodyMd]);

  // Auto-growing body: the page scrolls, not the textarea, so a long article is one continuous sheet.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [bodyMd, desktop]);
  useEffect(() => {
    const onResize = (): void => {
      const el = bodyRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${String(el.scrollHeight)}px`;
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // The caret line must not end up under the fixed toolbar when the browser scrolls it into view.
  useEffect(() => {
    if (!focused || desktop) return;
    const root = document.documentElement;
    root.style.scrollPaddingBottom = "4.5rem";
    return () => {
      root.style.scrollPaddingBottom = "";
    };
  }, [focused, desktop]);

  const readState = (): TextState | null => {
    const el = bodyRef.current;
    return el ? { value: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd } : null;
  };

  const saveSelection = (): void => {
    const el = bodyRef.current;
    if (el) selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const refreshSlash = useCallback((el: HTMLTextAreaElement): void => {
    const match =
      el.selectionStart === el.selectionEnd ? matchSlashCommand(el.value, el.selectionStart) : null;
    if (!match || dismissedSlash.current === match.from) {
      setSlash(null);
      return;
    }
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 28;
    setSlash({ match, top: measureOffsetTop(el, match.from) + lineHeight });
  }, []);

  const slashActions = useMemo(
    () => (slash ? filterSlashCommands(slash.match.query, (a) => t(TOOLBAR_LABELS[a])) : []),
    [slash],
  );
  const activeSlash = Math.min(slashIndex, Math.max(0, slashActions.length - 1));

  /** Runs a command at the textarea's current selection. */
  const run = (action: ToolbarAction, params: ToolbarParams = {}): void => {
    const el = bodyRef.current;
    if (!el || readOnly) return;
    if (action === "image" && params.mediaId === undefined) {
      saveSelection();
      setPickerOpen(true);
      return;
    }
    if ((action === "drug" || action === "glossary") && params.slug === undefined) {
      saveSelection();
      setEntityPrompt(action);
      return;
    }
    if (document.activeElement !== el) el.focus();
    const state = readState();
    if (!state) return;
    commitTextState(
      el,
      applyToolbarAction(state, action, {
        tableLabels: [t("admin.editor.table.column1"), t("admin.editor.table.column2")],
        ...params,
      }),
    );
  };

  /** After a dialog: put the selection back, then run. */
  const runAtSavedSelection = (action: ToolbarAction, params: ToolbarParams): void => {
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
    run(action, params);
  };

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      const el = bodyRef.current;
      if (!el || readOnly) return;
      el.focus();
      const state = readState();
      if (state) commitTextState(el, insertAtCaret(state, text));
    },
    focusBody: () => {
      bodyRef.current?.focus();
    },
    openImagePicker: () => {
      saveSelection();
      setPickerOpen(true);
    },
    addImages: (files: File[]) => {
      void handleImageFiles(files);
    },
  }));

  const chooseSlash = (action: ToolbarAction): void => {
    const el = bodyRef.current;
    if (!el || !slash) return;
    const { match } = slash;
    setSlash(null);
    const state = readState();
    if (!state) return;
    if (action === "image" || action === "drug" || action === "glossary") {
      // These need a dialog first: remove the typed `/query`, then ask.
      commitTextState(el, {
        value: state.value.slice(0, match.from) + state.value.slice(match.to),
        selStart: match.from,
        selEnd: match.from,
      });
      run(action);
      return;
    }
    commitTextState(
      el,
      applySlashCommand(state, match, action, {
        tableLabels: [t("admin.editor.table.column1"), t("admin.editor.table.column2")],
      }),
    );
  };

  // --- Images: pasted, dropped, picked -----------------------------------------------------------
  const handleImageFiles = async (files: File[]): Promise<void> => {
    saveSelection();
    for (const file of files.slice(0, IMAGE_BATCH_MAX)) {
      setUploading((n) => n + 1);
      try {
        const asset = await uploadMedia(file);
        setAltQueue((queue) => [...queue, asset]);
      } catch (error) {
        const reason = error instanceof MediaUploadError ? error.reason : "upload_failed";
        toast({ tone: "error", title: t(`admin.editor.upload.error.${reason}`) });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (readOnly) return;
    const data = event.clipboardData;
    const images = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
    if (images.length > 0) {
      event.preventDefault();
      void handleImageFiles(images);
      return;
    }
    const html = data.getData("text/html");
    if (html === "" || looksLikeCode(html)) return;
    const markdown = htmlToMarkdown(html);
    // Empty = nothing worth converting (or too large): the browser's plain-text paste proceeds.
    if (markdown === "") return;
    event.preventDefault();
    const el = event.currentTarget;
    commitTextState(
      el,
      insertAtCaret(
        { value: el.value, selStart: el.selectionStart, selEnd: el.selectionEnd },
        markdown,
      ),
    );
  };

  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer.types).includes("Files");

  const onDrop = (event: DragEvent<HTMLTextAreaElement>): void => {
    if (readOnly) return;
    const images = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    event.preventDefault();
    void handleImageFiles(images);
  };

  // --- Keyboard ---------------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slash) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = Math.max(1, slashActions.length);
        setSlashIndex(
          (current) => (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const action = slashActions[activeSlash];
        if (action) {
          event.preventDefault();
          chooseSlash(action);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissedSlash.current = slash.match.from;
        setSlash(null);
        return;
      }
    }
    // `code` is the physical key, so Ctrl+B works on an Arabic keyboard layout too.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const shortcut = { KeyB: "bold", KeyI: "italic", KeyK: "link" } as const;
      if (event.code === "KeyS") {
        event.preventDefault();
        onSave();
      } else if (event.code in shortcut) {
        event.preventDefault();
        run(shortcut[event.code as keyof typeof shortcut]);
      }
    }
  };

  // --- Outline ----------------------------------------------------------------------------------
  const revealHeading = (offset: number): void => {
    const el = bodyRef.current;
    if (!el) return;
    setOutlineOpen(false);
    el.focus();
    const lineEnd = el.value.indexOf("\n", offset);
    el.setSelectionRange(offset, lineEnd === -1 ? el.value.length : lineEnd);
    const top = el.getBoundingClientRect().top + window.scrollY + measureOffsetTop(el, offset);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, top - 140), behavior: reduce ? "auto" : "smooth" });
  };

  const toolbarPlacement = desktop
    ? ({ mode: "sticky-top" } as const)
    : focused
      ? keyboard.supported
        ? ({ mode: "fixed", bottom: keyboard.inset } as const)
        : ({ mode: "sticky-bottom" } as const)
      : ({ mode: "static" } as const);

  const toolbar = (
    <FormatToolbar
      onAction={(action) => {
        run(action);
      }}
      disabled={readOnly}
      placement={toolbarPlacement}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("admin.editor.field.title")} required>
        {(control) => (
          <input
            {...control}
            type="text"
            dir="auto"
            lang={locale}
            value={payload.title}
            readOnly={readOnly}
            maxLength={200}
            placeholder={t("admin.editor.field.titlePlaceholder")}
            onChange={(event) => {
              onChange({ title: event.target.value });
            }}
            className={TITLE_CLASS}
          />
        )}
      </Field>

      {type === "glossary" ? (
        <Field
          label={t("admin.editor.field.definition")}
          hint={t("admin.editor.counter", {
            count: formatNumber([...payload.definition].length),
            max: 300,
          })}
        >
          {(control) => (
            <textarea
              {...control}
              dir="auto"
              lang={locale}
              rows={2}
              maxLength={300}
              readOnly={readOnly}
              value={payload.definition}
              onChange={(event) => {
                onChange({ definition: event.target.value });
              }}
              className={cn(FIELD_CLASS, "resize-y")}
            />
          )}
        </Field>
      ) : null}

      <Field
        label={t("admin.editor.field.excerpt")}
        hint={t("admin.editor.counter", {
          count: formatNumber([...payload.excerpt].length),
          max: 400,
        })}
      >
        {(control) => (
          <textarea
            {...control}
            dir="auto"
            lang={locale}
            rows={2}
            maxLength={400}
            readOnly={readOnly}
            value={payload.excerpt}
            onChange={(event) => {
              onChange({ excerpt: event.target.value });
            }}
            className={cn(FIELD_CLASS, "resize-y")}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={bodyId} className="text-base font-semibold text-text">
          {t("admin.editor.field.body")}
        </label>
        <div className="relative flex items-center gap-3 text-sm text-text-muted">
          {uploading > 0 ? (
            <span role="status" className="inline-flex items-center gap-1">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {t("admin.editor.upload.working")}
            </span>
          ) : null}
          <span data-testid="word-count">
            {t("admin.editor.stats", {
              words: formatNumber(words),
              minutes: formatNumber(readingMinutes(words)),
            })}
          </span>
          <button
            type="button"
            aria-expanded={outlineOpen}
            aria-haspopup="true"
            disabled={headings.length === 0}
            onClick={() => {
              setOutlineOpen((open) => !open);
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50"
          >
            <ListTree aria-hidden className="size-5" />
            {t("admin.editor.outline.button", { count: headings.length })}
          </button>
          {outlineOpen ? (
            <nav
              aria-label={t("admin.editor.outline.title")}
              className="absolute end-0 top-full z-20 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-raised"
            >
              <ul>
                {headings.map((heading) => (
                  <li key={heading.offset}>
                    <button
                      type="button"
                      onClick={() => {
                        revealHeading(heading.offset);
                      }}
                      style={{ paddingInlineStart: `${String(0.75 + (heading.level - 2) * 1)}rem` }}
                      className="flex min-h-11 w-full items-center rounded-md pe-3 text-start text-base text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      <bdi>{heading.text}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </div>

      <div className={cn("flex flex-col", !desktop && "gap-0")}>
        {desktop ? toolbar : <div className="h-11">{toolbar}</div>}
        <div className="relative">
          <textarea
            id={bodyId}
            ref={bodyRef}
            dir="auto"
            lang={locale}
            spellCheck
            readOnly={readOnly}
            value={bodyMd}
            placeholder={t("admin.editor.field.bodyPlaceholder")}
            aria-autocomplete="list"
            aria-controls={slash ? menuId : undefined}
            aria-activedescendant={
              slash && slashActions.length > 0 ? slashOptionId(menuId, activeSlash) : undefined
            }
            onChange={(event) => {
              dismissedSlash.current = null;
              onChange({ bodyMd: event.target.value });
              refreshSlash(event.target);
            }}
            onSelect={(event) => {
              const el = event.currentTarget;
              selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
              refreshSlash(el);
              onLinkContext(
                linkQueryAt(el.value, el.selectionStart, el.selectionEnd, payload.title),
              );
            }}
            onFocus={() => {
              setFocused(true);
              onBodyFocusChange(true);
            }}
            onBlur={() => {
              setFocused(false);
              onBodyFocusChange(false);
              setSlash(null);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(event) => {
              if (!readOnly && hasFiles(event)) event.preventDefault();
            }}
            style={{ unicodeBidi: "plaintext" }}
            className={cn(
              "block min-h-[60dvh] w-full resize-none overflow-hidden border border-neutral-400 bg-surface px-4 py-3 font-body text-lg leading-8 text-start text-text",
              "placeholder:text-text-muted focus-visible:border-ring focus-visible:outline-none focus-visible:shadow-focus read-only:bg-neutral-50",
              desktop ? "rounded-b-md" : "rounded-md pb-20",
            )}
          />
          {slash ? (
            <SlashMenu
              id={menuId}
              actions={slashActions}
              activeIndex={activeSlash}
              top={slash.top}
              onHover={setSlashIndex}
              onSelect={chooseSlash}
            />
          ) : null}
        </div>
      </div>

      <EntityPromptDialog
        open={entityPrompt !== null}
        kind={entityPrompt ?? "drug"}
        onCancel={() => {
          setEntityPrompt(null);
          bodyRef.current?.focus();
        }}
        onConfirm={(slug) => {
          const kind = entityPrompt;
          setEntityPrompt(null);
          if (kind) runAtSavedSelection(kind, { slug });
        }}
      />

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(asset) => {
          setPickerOpen(false);
          setAltQueue((queue) => [...queue, asset]);
        }}
      />

      <AltPromptDialog
        open={altQueue.length > 0}
        asset={altQueue[0] ?? null}
        locale={locale}
        onCancel={() => {
          setAltQueue((queue) => queue.slice(1));
          bodyRef.current?.focus();
        }}
        onConfirm={({ alt, caption }) => {
          const asset = altQueue[0];
          setAltQueue((queue) => queue.slice(1));
          if (asset) runAtSavedSelection("image", { mediaId: asset.id, alt, caption });
        }}
      />
    </div>
  );
}
