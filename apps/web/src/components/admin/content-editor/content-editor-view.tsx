"use client";

import { t } from "@wasfa/shared/i18n";
import { previewTokenResponseSchema } from "@wasfa/shared/schemas/content";
import { Button, Dialog, Skeleton, useToast } from "@wasfa/ui";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarX2,
  Copy,
  ExternalLink,
  Languages,
  PanelRightClose,
  PanelRightOpen,
  Upload,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useRef, useState } from "react";

import { api } from "../../../lib/api-client";
import {
  ACTION_LABELS,
  derivePrimaryAction,
  overflowActions,
} from "../../../lib/content-editor/actions";
import {
  useContentEditor,
  type NewItemParams,
} from "../../../lib/content-editor/use-content-editor";
import { useEditorSettings } from "../../../lib/content-editor/use-editor-settings";
import { useMediaAsset } from "../../../lib/content-editor/use-media-asset";
import {
  DESKTOP_QUERY,
  WIDE_QUERY,
  useMediaQuery,
} from "../../../lib/content-editor/use-media-query";
import { useRenderPreview } from "../../../lib/content-editor/use-render-preview";
import { publicEnv } from "../../../lib/env";
import { toApiError } from "../../../lib/forms";
import { useContentOptions } from "../../../lib/use-content-options";
import { ErrorNotice } from "../../error-notice";
import { ConfirmDialog } from "../confirm-dialog";
import { MediaPickerDialog } from "../media-picker-dialog";

import { ArchiveDialog, PublishDialog, ScheduleDialog } from "./action-dialogs";
import { type MenuEntry } from "./action-menu";
import { ConflictDialog } from "./conflict-dialog";
import { EditorPanel, PANEL_LABELS, type PanelTab } from "./editor-panel";
import { FullscreenDialog } from "./fullscreen-dialog";
import { GateList } from "./gate-list";
import { HistoryTab } from "./history-tab";
import { MediaTab } from "./media-tab";
import { MobileBar, type MobileBarTarget } from "./mobile-bar";
import { PreviewPane } from "./preview-pane";
import { PublishTab } from "./publish-tab";
import { ReviewTab } from "./review-tab";
import { SeoTab } from "./seo-tab";
import { TopBar } from "./top-bar";
import { WritingArea, type WritingAreaHandle } from "./writing-area";

import type { ContentAction } from "@wasfa/shared/content/constants";

export interface ContentEditorViewProps {
  /** The item to edit; null on `/admin/content/new`. */
  itemId: string | null;
  newItem?: NewItemParams | undefined;
  permissions: readonly string[];
}

type DialogName = "schedule" | "publish" | "archive" | "unpublish" | null;
type PickerTarget = "featured" | "og" | null;

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export function ContentEditorView({ itemId, newItem, permissions }: ContentEditorViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const editor = useContentEditor({ itemId, newItem, permissions });
  const options = useContentOptions();
  const settings = useEditorSettings();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const wide = useMediaQuery(WIDE_QUERY);
  const writingRef = useRef<WritingAreaHandle>(null);

  const [tab, setTab] = useState<PanelTab>("publish");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [dialog, setDialog] = useState<DialogName>(null);
  const [picker, setPicker] = useState<PickerTarget>(null);

  const draft = editor.draft;
  const detail = editor.detail;
  const deferredBody = useDeferredValue(draft?.payload.bodyMd ?? "");
  const featured = useMediaAsset(draft?.meta.featuredMediaId ?? null);
  const ogImage = useMediaAsset(draft?.meta.seo.ogImageMediaId ?? null);
  const preview = useRenderPreview({
    enabled: previewOpen,
    type: editor.type,
    locale: editor.locale,
    bodyMd: draft?.payload.bodyMd ?? "",
    flags: {
      showToc: draft?.meta.flags.showToc ?? false,
      autoLink: draft?.meta.flags.autoLink ?? true,
    },
  });

  // Ctrl/Cmd+S saves from anywhere on the page (the writing area handles it itself while focused);
  // without this the browser's own "save page" dialog opens when focus sits on a button.
  const saveRef = useRef(() => {});
  useEffect(() => {
    saveRef.current = () => {
      if (editor.canWrite) void editor.save();
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.code !== "KeyS") return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (editor.loadState === "loading" || (editor.loadState === "ready" && draft === null)) {
    return <EditorSkeleton />;
  }
  if (editor.loadState === "error" || draft === null) {
    return (
      <ErrorNotice
        error={toApiError(editor.loadError)}
        onRetry={() => {
          router.refresh();
        }}
      />
    );
  }

  const optionsData = options.status === "ready" ? options.data : null;
  const featuredAsset = featured.status === "ready" ? featured.data : null;
  const ogAsset = ogImage.status === "ready" ? ogImage.data : null;
  const readOnly = !editor.canEdit;
  const allowed = detail?.allowedActions ?? [];

  const primary = derivePrimaryAction({
    isNew: editor.isNew,
    dirty: editor.dirty,
    status: detail?.status ?? "draft",
    live: detail?.live ?? false,
    allowedActions: allowed,
    canWrite: editor.canWrite,
  });

  // --- Actions ----------------------------------------------------------------------------------
  const openDialog = (name: DialogName): void => {
    editor.dismissBanner();
    setDialog(name);
  };

  const handleAction = (action: ContentAction): void => {
    switch (action) {
      case "publish":
        openDialog("publish");
        break;
      case "schedule":
        openDialog("schedule");
        break;
      case "unpublish":
        openDialog("unpublish");
        break;
      case "archive":
        openDialog("archive");
        break;
      default:
        void editor.runAction(action);
    }
  };

  const onPrimary = (): void => {
    if (primary.kind === "save") void editor.save();
    else handleAction(primary.action);
  };

  const openPreviewLink = async (): Promise<void> => {
    if (!detail) return;
    // Open the tab inside the click's user gesture, then point it at the signed URL.
    const win = window.open("about:blank", "_blank");
    try {
      const token = await api(`/admin/content/items/${detail.id}/preview-token`, {
        method: "POST",
        schema: previewTokenResponseSchema,
      });
      if (win) {
        win.opener = null;
        win.location.href = token.url;
      }
    } catch {
      win?.close();
      toast({ tone: "error", title: t("admin.editor.menu.previewFailed") });
    }
  };

  const otherLocale = editor.locale === "ar" ? "en" : "ar";
  const newUrl = (extra: string): string =>
    `/admin/content/new?type=${editor.type}&locale=${extra}`;

  const menu: MenuEntry[] = [];
  if (detail) {
    const icons: Partial<Record<ContentAction, React.ReactNode>> = {
      schedule: <CalendarClock className="size-5" />,
      unschedule: <CalendarX2 className="size-5" />,
      unpublish: <X className="size-5" />,
      archive: <Archive className="size-5" />,
      unarchive: <ArchiveRestore className="size-5" />,
    };
    for (const action of overflowActions(allowed)) {
      menu.push({
        id: action,
        label: t(ACTION_LABELS[action]),
        icon: icons[action],
        tone: action === "archive" || action === "unpublish" ? "danger" : "default",
        onSelect: () => {
          handleAction(action);
        },
      });
    }
    if (editor.canWrite) {
      menu.push({
        id: "duplicate",
        label: t("admin.editor.menu.duplicate"),
        icon: <Copy className="size-5" />,
        onSelect: () => {
          router.push(`${newUrl(editor.locale)}&duplicateOf=${detail.id}`);
        },
      });
      if (!detail.translation) {
        menu.push({
          id: "translate",
          label: t(
            editor.locale === "ar"
              ? "admin.editor.menu.translateEn"
              : "admin.editor.menu.translateAr",
          ),
          icon: <Languages className="size-5" />,
          onSelect: createTwin,
        });
      }
    }
    menu.push({
      id: "preview-link",
      label: t("admin.editor.menu.previewLink"),
      icon: <ExternalLink className="size-5" />,
      onSelect: () => {
        void openPreviewLink();
      },
    });
  }

  function createTwin(): void {
    if (!detail) return;
    router.push(`${newUrl(otherLocale)}&translationOf=${detail.id}`);
  }

  const openPanel = (next: MobileBarTarget): void => {
    if (next === "preview") {
      setPreviewOpen(true);
      return;
    }
    setTab(next);
    setSheetOpen(true);
  };

  const panelTabs: PanelTab[] = editor.isNew
    ? ["publish", "seo", "media"]
    : ["publish", "seo", "media", "review", "history"];

  const renderTab = (name: PanelTab) => {
    switch (name) {
      case "publish":
        return (
          <PublishTab
            detail={detail}
            draft={draft}
            type={editor.type}
            locale={editor.locale}
            options={optionsData}
            settings={settings}
            featured={featuredAsset}
            readOnly={readOnly}
            busy={editor.actionBusy}
            onMeta={editor.setMeta}
            onPickFeatured={() => {
              setPicker("featured");
            }}
            onCreateTwin={createTwin}
            onAction={handleAction}
          />
        );
      case "seo":
        return (
          <SeoTab
            detail={detail}
            draft={draft}
            bodyMd={deferredBody}
            type={editor.type}
            locale={editor.locale}
            settings={settings}
            permissions={permissions}
            options={optionsData}
            readOnly={readOnly}
            slugTaken={editor.slugTaken}
            linkQuery={linkQuery}
            origin={publicEnv.NEXT_PUBLIC_SITE_URL}
            featured={featuredAsset}
            ogImage={ogAsset}
            onMeta={editor.setMeta}
            onPickOgImage={() => {
              setPicker("og");
            }}
            onInsertLink={(anchor, path) => {
              writingRef.current?.insertText(`[${anchor}](${path})`);
            }}
          />
        );
      case "media":
        return (
          <MediaTab
            bodyMd={deferredBody}
            locale={editor.locale}
            featured={featuredAsset}
            readOnly={readOnly}
            onPickFeatured={() => {
              setPicker("featured");
            }}
            onInsertFromLibrary={() => {
              setSheetOpen(false);
              writingRef.current?.openImagePicker();
            }}
            onUploadFiles={(files) => {
              setSheetOpen(false);
              writingRef.current?.addImages(files);
            }}
          />
        );
      case "review":
        return detail ? (
          <ReviewTab
            detail={detail}
            draft={draft}
            baseline={editor.baseline}
            permissions={permissions}
            payloadDirty={editor.payloadDirty}
            busy={editor.actionBusy}
            onAction={editor.runAction}
          />
        ) : null;
      case "history":
        return detail ? (
          <HistoryTab
            itemId={detail.id}
            currentRevisionId={detail.currentRevision.id}
            canRestore={permissions.includes("content.write")}
            dirty={editor.dirty}
            onRestore={async (revisionId) => {
              await editor.restoreRevision(revisionId);
            }}
          />
        ) : null;
    }
  };

  const panel = <EditorPanel tab={tab} onTabChange={setTab} tabs={panelTabs} render={renderTab} />;
  const blockingFromError = (detail?.gates ?? []).filter((gate) =>
    editor.banner?.gateIds.includes(gate.id),
  );
  const splitPreview = previewOpen && wide;

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      <h2 className="sr-only">{t("admin.editor.title")}</h2>
      <p className="sr-only" role="status" aria-live="polite">
        {editor.announcement}
      </p>

      <TopBar
        status={detail?.status ?? null}
        live={detail?.live ?? false}
        hasUnpublishedChanges={detail?.hasUnpublishedChanges ?? false}
        dirty={editor.dirty}
        autosave={editor.autosave}
        primary={primary}
        primaryBusy={
          editor.saving || (primary.kind === "action" && editor.actionBusy === primary.action)
        }
        primaryDisabled={
          primary.kind === "save"
            ? primary.disabled ||
              !editor.canWrite ||
              (editor.isNew && draft.payload.title.trim() === "")
            : editor.actionBusy !== null
        }
        previewOpen={previewOpen}
        menu={menu}
        onPrimary={onPrimary}
        onTogglePreview={() => {
          setPreviewOpen((open) => !open);
        }}
      />

      {editor.restoreOffer ? (
        <div
          role="region"
          aria-label={t("admin.editor.restore.title")}
          className="flex flex-col gap-3 rounded-lg border border-info bg-primary-soft p-4"
        >
          <p className="text-base text-text">
            {t(
              editor.restoreOffer.source === "server"
                ? "admin.editor.restore.server"
                : "admin.editor.restore.local",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={editor.applyRestoreOffer}>
              <Upload aria-hidden className="size-5" />
              {t("admin.editor.restore.apply")}
            </Button>
            <Button variant="ghost" onClick={editor.dismissRestoreOffer}>
              {t("admin.editor.restore.dismiss")}
            </Button>
          </div>
        </div>
      ) : null}

      {editor.banner && dialog === null ? (
        <div
          role="alert"
          className={`flex flex-col gap-2 rounded-lg border p-4 ${editor.banner.tone === "error" ? "border-danger bg-danger-soft" : "border-border bg-primary-soft"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-base text-text">{editor.banner.message}</p>
            <button
              type="button"
              aria-label={t("admin.editor.banner.dismiss")}
              onClick={editor.dismissBanner}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:text-text focus-visible:outline-none focus-visible:shadow-focus"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {blockingFromError.length > 0 ? <GateList gates={blockingFromError} /> : null}
        </div>
      ) : null}

      <div
        className={
          desktop
            ? panelCollapsed
              ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6"
              : "grid grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)] items-start gap-6"
            : "block"
        }
      >
        <div className={splitPreview ? "grid grid-cols-2 items-start gap-6" : "min-w-0"}>
          <WritingArea
            ref={writingRef}
            type={editor.type}
            locale={editor.locale}
            payload={draft.payload}
            onChange={editor.setPayload}
            readOnly={readOnly}
            desktop={desktop}
            onSave={() => {
              if (editor.canWrite) void editor.save();
            }}
            onBodyFocusChange={setBodyFocused}
            onLinkContext={setLinkQuery}
          />
          {splitPreview ? (
            <div className="sticky top-36 max-h-[calc(100dvh-10rem)] min-w-0 overflow-y-auto rounded-lg border border-border bg-surface p-4">
              <PreviewPane state={preview.state} stale={preview.stale} locale={editor.locale} />
            </div>
          ) : null}
        </div>

        {desktop ? (
          panelCollapsed ? (
            <button
              type="button"
              aria-label={t("admin.editor.panel.expand")}
              onClick={() => {
                setPanelCollapsed(false);
              }}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
            >
              <PanelRightOpen aria-hidden className="size-5 rtl:-scale-x-100" />
            </button>
          ) : (
            <aside
              aria-label={t("admin.editor.panel.label")}
              className="sticky top-36 max-h-[calc(100dvh-10rem)] overflow-y-auto rounded-lg border border-border bg-surface p-4"
            >
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  aria-label={t("admin.editor.panel.collapse")}
                  onClick={() => {
                    setPanelCollapsed(true);
                  }}
                  className="inline-flex size-11 items-center justify-center rounded-lg text-text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <PanelRightClose aria-hidden className="size-5 rtl:-scale-x-100" />
                </button>
              </div>
              {panel}
            </aside>
          )
        ) : null}
      </div>

      {!desktop && !bodyFocused ? <MobileBar onSelect={openPanel} /> : null}

      {/* Mobile: the panel opens as a bottom sheet over the editor. */}
      <Dialog
        open={!desktop && sheetOpen}
        onOpenChange={setSheetOpen}
        title={t(PANEL_LABELS[tab])}
        className="sm:max-w-xl"
      >
        {!desktop && sheetOpen ? panel : null}
      </Dialog>

      {/* Preview full screen when there is no room for the split view. */}
      <FullscreenDialog
        open={previewOpen && !wide}
        onClose={() => {
          setPreviewOpen(false);
        }}
        title={t("admin.editor.preview.title")}
      >
        <PreviewPane state={preview.state} stale={preview.stale} locale={editor.locale} />
      </FullscreenDialog>

      <PublishDialog
        open={dialog === "publish"}
        onClose={() => {
          setDialog(null);
        }}
        gates={detail?.gates ?? []}
        advisory={
          (detail?.allowedActions ?? []).includes("publish") &&
          (detail?.gates ?? []).some((gate) => gate.level === "block" && !gate.ok)
        }
        live={detail?.live ?? false}
        path={detail?.publicPath ?? null}
        busy={editor.actionBusy === "publish"}
        error={editor.banner?.message ?? null}
        onConfirm={() => editor.runAction("publish")}
      />
      <ScheduleDialog
        open={dialog === "schedule"}
        onClose={() => {
          setDialog(null);
        }}
        timeZone={settings.timeZone}
        busy={editor.actionBusy === "schedule"}
        error={editor.banner?.message ?? null}
        onConfirm={(at) => editor.runAction("schedule", { at: at.toISOString() })}
      />
      <ArchiveDialog
        open={dialog === "archive"}
        onClose={() => {
          setDialog(null);
        }}
        wasPublished={Boolean(detail?.live || detail?.publishedAt)}
        busy={editor.actionBusy === "archive"}
        error={editor.banner?.message ?? null}
        onConfirm={(redirectTo) => editor.runAction("archive", redirectTo ? { redirectTo } : {})}
      />
      <ConfirmDialog
        open={dialog === "unpublish"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={t("admin.editor.unpublish.title")}
        description={t("admin.editor.unpublish.body")}
        confirmLabel={t("admin.editor.action.unpublish")}
        tone="danger"
        onConfirm={async () => {
          await editor.runAction("unpublish");
        }}
      />

      <MediaPickerDialog
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
        onSelect={(asset) => {
          const target = picker;
          setPicker(null);
          if (target === "featured") {
            editor.setMeta((meta) => ({ ...meta, featuredMediaId: asset.id }));
          } else if (target === "og") {
            editor.setMeta((meta) => ({ ...meta, seo: { ...meta.seo, ogImageMediaId: asset.id } }));
          }
        }}
      />

      {detail ? (
        <ConflictDialog
          itemId={detail.id}
          conflict={editor.conflict}
          mine={draft.payload}
          busy={editor.saving}
          onOverwrite={editor.overwriteConflict}
          onReload={editor.reloadTheirs}
          onClose={editor.dismissConflict}
        />
      ) : null}
    </div>
  );
}
