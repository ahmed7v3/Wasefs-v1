"use client";

import { t } from "@wasfa/shared/i18n";
import { useToast } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api-client";
import { autosaveAckSchema, createdItemSchema } from "../content-editor-schemas";
import { useReauth } from "../reauth";

import {
  AutosaveScheduler,
  clearMirror,
  newItemMirrorKey,
  pickRestoreOffer,
  readMirror,
  writeMirror,
  type AutosaveStatus,
  type RestoreOffer,
} from "./autosave";
import { conflictFromError, type ConflictInfo } from "./conflict";
import {
  buildCreateBody,
  buildUpdateBody,
  draftFromDetail,
  emptyDraft,
  isMetaDirty,
  isPayloadDirty,
  serializePayload,
  twinDraft,
  type EditorDraft,
} from "./draft";
import { describeContentError } from "./errors";
import { useContentItem } from "./use-content-item";

import type { ContentAction, ContentLocale, ContentType } from "@wasfa/shared/content/constants";
import type { MessageKey } from "@wasfa/shared/i18n";
import type {
  ContentActionBody,
  ContentItemDetail,
  ContentMeta,
  ContentPayload,
  QualityGate,
} from "@wasfa/shared/schemas/content";

export interface NewItemParams {
  type: ContentType;
  locale: ContentLocale;
  /** Create the other-language twin of this item (its title and metadata prefill the form). */
  translationOf?: string | undefined;
  /** Start from a copy of this item. */
  duplicateOf?: string | undefined;
}

export interface UseContentEditorParams {
  /** The item being edited; null = `/admin/content/new`. */
  itemId: string | null;
  newItem?: NewItemParams | undefined;
  permissions: readonly string[];
}

export interface EditorBanner {
  tone: "error" | "info";
  message: string;
  gateIds: string[];
}

export type LoadState = "loading" | "error" | "ready";

export type ActionResult = "ok" | "failed";

export interface ContentEditor {
  loadState: LoadState;
  loadError: unknown;
  isNew: boolean;
  type: ContentType;
  locale: ContentLocale;
  detail: ContentItemDetail | null;
  draft: EditorDraft | null;
  baseline: EditorDraft;
  payloadDirty: boolean;
  metaDirty: boolean;
  dirty: boolean;
  /** May type in the writing area (a writer, or a reviewer reviewing an item in review). */
  canEdit: boolean;
  /** May create revisions (Save, autosave). */
  canWrite: boolean;
  gates: readonly QualityGate[];
  setPayload: (patch: Partial<ContentPayload>) => void;
  setMeta: (update: (meta: ContentMeta) => ContentMeta) => void;
  replaceDraft: (draft: EditorDraft) => void;
  autosave: AutosaveStatus;
  saving: boolean;
  save: (options?: { note?: string }) => Promise<ContentItemDetail | null>;
  actionBusy: ContentAction | null;
  runAction: (
    action: ContentAction,
    body?: Omit<ContentActionBody, "lockVersion">,
    options?: { skipSave?: boolean },
  ) => Promise<ActionResult>;
  restoreRevision: (revisionId: string) => Promise<ActionResult>;
  refetch: () => Promise<ContentItemDetail | null>;
  banner: EditorBanner | null;
  dismissBanner: () => void;
  /** Text for the polite live region: the last save/action result. */
  announcement: string;
  slugTaken: boolean;
  conflict: ConflictInfo | null;
  dismissConflict: () => void;
  overwriteConflict: () => Promise<void>;
  reloadTheirs: () => Promise<void>;
  restoreOffer: RestoreOffer | null;
  applyRestoreOffer: () => void;
  dismissRestoreOffer: () => void;
  /** Mirror key of the local copy (for tests and the conflict dialog's "copy my text"). */
  mirrorKey: string;
}

const sameDraft = (a: EditorDraft | null, b: EditorDraft | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const MIRROR_DEBOUNCE_MS = 400;

export function useContentEditor(params: UseContentEditorParams): ContentEditor {
  const { itemId, newItem, permissions } = params;
  const isNew = itemId === null;
  const router = useRouter();
  const reauth = useReauth();
  const { toast } = useToast();

  const item = useContentItem(itemId);
  const refetch = item.refetch;
  const sourceId = isNew ? (newItem?.translationOf ?? newItem?.duplicateOf ?? null) : null;
  const source = useContentItem(sourceId);

  const detail = item.state.status === "ready" ? item.state.detail : null;
  const sourceDetail = source.state.status === "ready" ? source.state.detail : null;
  const type: ContentType = detail?.type ?? newItem?.type ?? "article";
  const locale: ContentLocale = detail?.locale ?? newItem?.locale ?? "ar";
  const mirrorKey = detail ? detail.id : newItemMirrorKey(type, locale);

  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [newBaseline, setNewBaseline] = useState<EditorDraft>(() => emptyDraft());
  const [restoreOffer, setRestoreOffer] = useState<RestoreOffer | null>(null);
  const [autosave, setAutosave] = useState<AutosaveStatus>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<ContentAction | null>(null);
  const [banner, setBanner] = useState<EditorBanner | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [slugTaken, setSlugTaken] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const canWrite = permissions.includes("content.write") && detail?.status !== "archived";
  const reviewerEditing =
    permissions.includes("content.review") &&
    detail?.status === "in_review" &&
    detail.allowedActions.includes("approve");
  const canEdit = isNew
    ? canWrite || permissions.includes("content.write")
    : canWrite || reviewerEditing;

  // --- Load state -------------------------------------------------------------------------------
  const loadState: LoadState = isNew
    ? sourceId === null
      ? "ready"
      : source.state.status
    : item.state.status;
  const loadError =
    item.state.status === "error"
      ? item.state.error
      : source.state.status === "error"
        ? source.state.error
        : null;

  const baseline = useMemo<EditorDraft>(
    () => (isNew ? newBaseline : detail ? draftFromDetail(detail) : emptyDraft()),
    [isNew, newBaseline, detail],
  );

  // --- Refs mirror the latest values for timers and async callbacks -----------------------------
  const draftRef = useRef(draft);
  const baselineRef = useRef(baseline);
  const detailRef = useRef(detail);
  const schedulerRef = useRef<AutosaveScheduler | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    draftRef.current = draft;
    baselineRef.current = baseline;
    detailRef.current = detail;
  }, [draft, baseline, detail]);

  // --- First load: fill the draft ---------------------------------------------------------------
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    if (!isNew && detail) {
      initialised.current = true;
      setDraft(draftFromDetail(detail));
      setRestoreOffer(pickRestoreOffer(detail, readMirror(detail.id)));
      return;
    }
    if (isNew && (sourceId === null || sourceDetail)) {
      initialised.current = true;
      let base = emptyDraft();
      if (sourceDetail && newItem?.translationOf) base = twinDraft(draftFromDetail(sourceDetail));
      else if (sourceDetail) {
        const copy = draftFromDetail(sourceDetail);
        base = {
          payload: {
            ...copy.payload,
            title: t("admin.editor.duplicate.title", { title: copy.payload.title }),
          },
          meta: { ...copy.meta, slug: "" },
        };
      }
      setNewBaseline(base);
      setDraft(base);
      const mirror = readMirror(newItemMirrorKey(type, locale));
      if (mirror && !sameDraft({ payload: mirror.payload, meta: mirror.meta }, base)) {
        setRestoreOffer({
          source: "local",
          payload: mirror.payload,
          meta: mirror.meta,
          savedAt: mirror.savedAt,
        });
      }
    }
  }, [isNew, detail, sourceId, sourceDetail, newItem?.translationOf, type, locale]);

  const payloadDirty = draft !== null && isPayloadDirty(baseline.payload, draft.payload);
  const metaDirty = draft !== null && isMetaDirty(baseline.meta, draft.meta);
  const dirty = payloadDirty || metaDirty;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // --- Draft mutations --------------------------------------------------------------------------
  const setPayload = useCallback((patch: Partial<ContentPayload>) => {
    setDraft((current) =>
      current ? { ...current, payload: { ...current.payload, ...patch } } : current,
    );
  }, []);

  const setMeta = useCallback((update: (meta: ContentMeta) => ContentMeta) => {
    setSlugTaken(false);
    setDraft((current) => (current ? { ...current, meta: update(current.meta) } : current));
  }, []);

  const replaceDraft = useCallback((next: EditorDraft) => {
    setDraft(next);
  }, []);

  // --- Autosave scheduler -----------------------------------------------------------------------
  const detailId = detail?.id ?? null;
  useEffect(() => {
    if (detailId === null || !canWrite) return;
    const scheduler = new AutosaveScheduler(
      {
        now: () => Date.now(),
        isVisible: () => document.visibilityState === "visible",
        snapshot: () => {
          const current = draftRef.current;
          // The autosave contract needs a title; an empty one would only answer 400.
          return current && current.payload.title.trim() !== ""
            ? serializePayload(current.payload)
            : null;
        },
        save: async () => {
          const current = draftRef.current;
          const loaded = detailRef.current;
          if (!current || !loaded) return;
          await api(`/admin/content/items/${loaded.id}/autosave`, {
            method: "PUT",
            body: { baseRevisionId: loaded.currentRevision.id, payload: current.payload },
            schema: autosaveAckSchema,
          });
        },
        onStatus: setAutosave,
      },
      serializePayload(baselineRef.current.payload),
    );
    schedulerRef.current = scheduler;
    const onVisibility = (): void => {
      scheduler.notifyVisibility();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [detailId, canWrite]);

  const payloadForAutosave = draft?.payload;
  useEffect(() => {
    if (payloadForAutosave) schedulerRef.current?.notifyChange();
  }, [payloadForAutosave]);

  // --- Local mirror -----------------------------------------------------------------------------
  useEffect(() => {
    if (draft === null) return;
    const write = (): void => {
      if (dirtyRef.current) {
        writeMirror(mirrorKey, {
          savedAt: Date.now(),
          baseRevisionId: detailRef.current?.currentRevision.id ?? null,
          payload: draft.payload,
          meta: draft.meta,
        });
      } else {
        clearMirror(mirrorKey);
      }
    };
    const timer = setTimeout(write, MIRROR_DEBOUNCE_MS);
    const onHide = (): void => {
      clearTimeout(timer);
      write();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", onHide);
    };
  }, [draft, dirty, mirrorKey]);

  // Leaving with unsaved edits asks first (the mirror also keeps them, but a prompt avoids the surprise).
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);

  // --- Writes -----------------------------------------------------------------------------------
  const announce = useCallback((key: MessageKey) => {
    setAnnouncement(t(key));
  }, []);

  const showError = useCallback((error: unknown) => {
    const described = describeContentError(error);
    setBanner({ tone: "error", message: described.message, gateIds: described.gateIds });
    setAnnouncement(described.message);
    if (described.code === "CONTENT_SLUG_TAKEN") setSlugTaken(true);
  }, []);

  /** After a write: fetch the server copy and adopt it unless the user typed while the write ran. */
  const adoptServerCopy = useCallback(
    async (sentDraft: EditorDraft): Promise<ContentItemDetail | null> => {
      const fresh = await refetch();
      if (fresh && sameDraft(draftRef.current, sentDraft)) {
        setDraft(draftFromDetail(fresh));
        clearMirror(fresh.id);
        schedulerRef.current?.markSaved(serializePayload(fresh.payload));
      }
      return fresh;
    },
    [refetch],
  );

  const save = useCallback(
    async (
      options: { note?: string; lockVersion?: number } = {},
    ): Promise<ContentItemDetail | null> => {
      const current = draftRef.current;
      if (!current || savingRef.current) return null;
      savingRef.current = true;
      setSaving(true);
      setBanner(null);
      try {
        if (isNew) {
          if (current.payload.title.trim() === "") {
            setBanner({
              tone: "error",
              message: t("admin.editor.error.titleRequired"),
              gateIds: [],
            });
            return null;
          }
          const created = await api("/admin/content/items", {
            method: "POST",
            body: buildCreateBody({
              type,
              locale,
              translationOf: newItem?.translationOf,
              draft: current,
            }),
            schema: createdItemSchema,
          });
          clearMirror(mirrorKey);
          router.replace(`/admin/content/${created.id}`);
          return null;
        }
        const loaded = detailRef.current;
        if (!loaded) return null;
        const body = buildUpdateBody(
          baselineRef.current,
          current,
          options.lockVersion ?? loaded.lockVersion,
          options.note,
        );
        if (!body) return loaded;
        await api(`/admin/content/items/${loaded.id}`, { method: "PATCH", body });
        setAutosave({ kind: "saved", at: Date.now() });
        setAnnouncement(t("admin.editor.result.saved"));
        return await adoptServerCopy(current);
      } catch (error) {
        const found = conflictFromError(error);
        if (found) {
          setConflict(found);
          return null;
        }
        showError(error);
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [isNew, type, locale, newItem?.translationOf, mirrorKey, router, adoptServerCopy, showError],
  );

  const runAction = useCallback(
    async (
      action: ContentAction,
      body: Omit<ContentActionBody, "lockVersion"> = {},
      options: { skipSave?: boolean } = {},
    ): Promise<ActionResult> => {
      const loaded = detailRef.current;
      if (!loaded) return "failed";
      let lockVersion = loaded.lockVersion;
      if (!options.skipSave && dirtyRef.current && permissions.includes("content.write")) {
        const saved = await save();
        if (!saved) return "failed";
        lockVersion = saved.lockVersion;
      }
      const startDraft = draftRef.current;
      setActionBusy(action);
      setBanner(null);
      try {
        await reauth.run(() =>
          api(`/admin/content/items/${loaded.id}/actions/${action}`, {
            method: "POST",
            body: { lockVersion, ...body },
          }),
        );
        const fresh = await refetch();
        if (fresh && sameDraft(draftRef.current, startDraft)) {
          setDraft(draftFromDetail(fresh));
          clearMirror(fresh.id);
        }
        const message = t(`admin.editor.result.${action}`);
        setAnnouncement(message);
        toast({ tone: "success", title: message });
        return "ok";
      } catch (error) {
        showError(error);
        // A conflict or a stale state means the screen is out of date: show the server's truth.
        refetch().catch(() => undefined);
        return "failed";
      } finally {
        setActionBusy(null);
      }
    },
    [permissions, save, reauth, refetch, toast, showError],
  );

  const restoreRevision = useCallback(
    async (revisionId: string): Promise<ActionResult> => {
      const loaded = detailRef.current;
      if (!loaded) return "failed";
      setBanner(null);
      try {
        await api(`/admin/content/items/${loaded.id}/revisions/${revisionId}/restore`, {
          method: "POST",
          body: { lockVersion: loaded.lockVersion },
        });
        const fresh = await refetch();
        if (fresh) {
          setDraft(draftFromDetail(fresh));
          clearMirror(fresh.id);
          schedulerRef.current?.markSaved(serializePayload(fresh.payload));
        }
        announce("admin.editor.result.restored");
        toast({ tone: "success", title: t("admin.editor.result.restored") });
        return "ok";
      } catch (error) {
        const found = conflictFromError(error);
        if (found) setConflict(found);
        else showError(error);
        return "failed";
      }
    },
    [refetch, announce, toast, showError],
  );

  // --- Conflict ---------------------------------------------------------------------------------
  const dismissConflict = useCallback(() => {
    setConflict(null);
  }, []);

  const overwriteConflict = useCallback(async () => {
    const found = conflict;
    if (!found) return;
    setConflict(null);
    if (found.currentLockVersion < 0) {
      // No usable lock version in the answer: load theirs, the user re-applies their edit.
      await refetch().catch(() => undefined);
      return;
    }
    await save({ lockVersion: found.currentLockVersion });
  }, [conflict, refetch, save]);

  const reloadTheirs = useCallback(async () => {
    setConflict(null);
    const fresh = await refetch().catch(() => null);
    if (fresh) {
      setDraft(draftFromDetail(fresh));
      clearMirror(fresh.id);
      schedulerRef.current?.markSaved(serializePayload(fresh.payload));
    }
  }, [refetch]);

  // --- Restore offer ----------------------------------------------------------------------------
  const applyRestoreOffer = useCallback(() => {
    if (!restoreOffer) return;
    setDraft((current) => {
      const base = current ?? emptyDraft();
      return { payload: restoreOffer.payload, meta: restoreOffer.meta ?? base.meta };
    });
    setRestoreOffer(null);
  }, [restoreOffer]);

  const dismissRestoreOffer = useCallback(() => {
    setRestoreOffer(null);
    // Declining the offer is a decision: the stale local copy must not be offered again.
    clearMirror(mirrorKey);
  }, [mirrorKey]);

  const dismissBanner = useCallback(() => {
    setBanner(null);
  }, []);

  return {
    loadState,
    loadError,
    isNew,
    type,
    locale,
    detail,
    draft,
    baseline,
    payloadDirty,
    metaDirty,
    dirty,
    canEdit,
    canWrite: isNew ? permissions.includes("content.write") : canWrite,
    gates: detail?.gates ?? [],
    setPayload,
    setMeta,
    replaceDraft,
    autosave,
    saving,
    save,
    actionBusy,
    runAction,
    restoreRevision,
    refetch,
    banner,
    dismissBanner,
    announcement,
    slugTaken,
    conflict,
    dismissConflict,
    overwriteConflict,
    reloadTheirs,
    restoreOffer,
    applyRestoreOffer,
    dismissRestoreOffer,
    mirrorKey,
  };
}
