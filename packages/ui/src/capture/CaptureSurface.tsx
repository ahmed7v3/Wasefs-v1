"use client";

import { t } from "@wasfa/shared/i18n";
import { ImagePlus, Camera, Smartphone, WifiOff, X } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { Button, buttonStyles } from "../button";
import { cn } from "../cn";
import { useToast } from "../toast";

import { DropOverlay } from "./DropOverlay";
import { PageTray } from "./PageTray";
import { PhoneHandoff, type HandoffView } from "./PhoneHandoff";
import { QualityHint, describeIssues } from "./QualityHint";
import { filesFromTransfer, isFileDrag, isSupportedCaptureFile, moveItem } from "./transfer";
import {
  CaptureError,
  type CapturePage,
  type CaptureUploader,
  type HandoffClient,
  type PreparedImage,
} from "./types";

const ImageEditor = lazy(() =>
  import("./ImageEditor").then((module) => ({ default: module.ImageEditor })),
);

/** Pages one handoff code may add (mirrors `HANDOFF_MAX_FILES` on the api). */
const HANDOFF_MAX = 4;

export type CaptureVariant = "full" | "compact" | "composer";

export interface CaptureSurfaceProps {
  /** Plan limit (`rx.maxPages`). */
  maxPages: number;
  onPagesChange: (pages: CapturePage[]) => void;
  /** What Analyze costs and what the person has. Absent: no price is shown and nothing is gated. */
  price?: { perPage: number; balance: number } | undefined;
  /** Called with the file ids of every page, in order, once all are uploaded. Absent: no Analyze bar. */
  onAnalyze?: ((fileIds: string[]) => Promise<void> | void) | undefined;
  variant: CaptureVariant;
  disabled?: boolean | undefined;
  /** Browser-side processing and transport, injected by `apps/web`. */
  uploader: CaptureUploader;
  /** Desktop to phone handoff. Absent: the "use your phone" button is not shown. */
  handoff?: HandoffClient | undefined;
  /** Where "contact support" leads when credits run short (payments arrive in Phase 3). */
  supportHref?: string | undefined;
  /**
   * Pages that are already on the server (uploaded from the dashboard's quick capture): added at
   * mount through `handoff.adopt`, so they need `handoff`. Read once; later changes are ignored.
   */
  initialFileIds?: readonly string[] | undefined;
  /**
   * Show nothing while there are no pages (the composer's closed panel). Drop and paste still
   * work, and pages that arrive show up on their own.
   */
  collapsed?: boolean | undefined;
  /** Shows a close (X) button on the open panel; the owner hides the panel in response. */
  onClose?: (() => void) | undefined;
}

/** Per page, the parts that never go to the parent: the prepared image and its abort handle. */
interface PageInternals {
  image?: PreparedImage | undefined;
  controller: AbortController;
  /** The picked file, kept so a page that failed to prepare can be tried again. */
  source?: File | undefined;
  /** Came from a phone: it is on the server already and is not in this browser to edit. */
  remote?: boolean | undefined;
}

let counter = 0;
function newLocalId(): string {
  counter += 1;
  return `page-${Date.now().toString(36)}-${counter}`;
}

function blankPage(localId: string): CapturePage {
  return {
    localId,
    fileId: null,
    status: "processing",
    previewUrl: "",
    quality: { issues: [] },
  };
}

function revoke(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function failure(error: unknown): { message: string; ref: string | undefined } {
  if (error instanceof CaptureError) return { message: error.message, ref: error.ref };
  return { message: t("capture.error.generic"), ref: undefined };
}

function isAbort(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * The one capture component (Task 2.6): drop anywhere, paste, pick, camera, phone handoff, page
 * tray, quality hints, optional editor and the Analyze bar. It owns no transport: `uploader` and
 * `handoff` do the browser-side processing and the network, so it is tested with fakes.
 *
 * Mount one per page: the drop and paste listeners are on the window.
 */
export function CaptureSurface({
  maxPages,
  onPagesChange,
  price,
  onAnalyze,
  variant,
  disabled = false,
  uploader,
  handoff,
  supportHref = "/contact",
  initialFileIds,
  collapsed = false,
  onClose,
}: CaptureSurfaceProps) {
  const { toast } = useToast();
  const [pages, setPages] = useState<CapturePage[]>([]);
  const pagesRef = useRef<CapturePage[]>([]);
  const internals = useRef(new Map<string, PageInternals>());
  const [live, setLive] = useState("");
  const [dragging, setDragging] = useState(false);
  const [online, setOnline] = useState(true);
  const [touch, setTouch] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onPagesChange, disabled, maxPages });
  callbacks.current = { onPagesChange, disabled, maxPages };

  const announce = useCallback((message: string) => {
    // A trailing no-break space makes a repeated sentence count as a change for screen readers.
    setLive((current) => (current === message ? message + String.fromCharCode(160) : message));
  }, []);

  const commit = useCallback((update: (current: CapturePage[]) => CapturePage[]) => {
    pagesRef.current = update(pagesRef.current);
    setPages(pagesRef.current);
  }, []);

  const patch = useCallback(
    (localId: string, changes: Partial<CapturePage>) => {
      commit((current) =>
        current.map((page) => (page.localId === localId ? { ...page, ...changes } : page)),
      );
    },
    [commit],
  );

  useEffect(() => {
    callbacks.current.onPagesChange(pages);
  }, [pages]);

  // ---- uploading ---------------------------------------------------------------------------

  const startUpload = useCallback(
    (localId: string) => {
      const entry = internals.current.get(localId);
      if (!entry?.image) return;
      const controller = new AbortController();
      entry.controller = controller;
      const image = entry.image;
      patch(localId, {
        status: "uploading",
        progress: 0,
        errorMessage: undefined,
        errorRef: undefined,
      });
      uploader
        .upload(image, {
          signal: controller.signal,
          onProgress: (fraction) => {
            if (!isAbort(controller.signal)) patch(localId, { progress: fraction });
          },
        })
        .then(({ fileId }) => {
          if (isAbort(controller.signal)) return;
          patch(localId, { status: "uploaded", fileId, progress: 1 });
          const n = pagesRef.current.findIndex((page) => page.localId === localId) + 1;
          announce(t("capture.live.uploaded", { n }));
        })
        .catch((error: unknown) => {
          if (isAbort(controller.signal)) return;
          const { message, ref } = failure(error);
          patch(localId, { status: "error", errorMessage: message, errorRef: ref });
          const n = pagesRef.current.findIndex((page) => page.localId === localId) + 1;
          announce(t("capture.live.failed", { n }));
        });
    },
    [announce, patch, uploader],
  );

  // A prepared page either waits for a decision (quality issues) or goes straight up.
  const settle = useCallback(
    (localId: string, image: PreparedImage) => {
      const entry = internals.current.get(localId);
      if (!entry) return;
      entry.image = image;
      const previewUrl = URL.createObjectURL(image.blob);
      const previous = pagesRef.current.find((page) => page.localId === localId)?.previewUrl;
      if (previous) revoke(previous);
      const warn = image.issues.length > 0;
      patch(localId, {
        previewUrl,
        fileId: null,
        quality: { issues: image.issues },
        status: warn ? "warning" : "uploading",
        progress: 0,
      });
      const n = pagesRef.current.findIndex((page) => page.localId === localId) + 1;
      if (warn) {
        announce(t("capture.live.warning", { n, issues: describeIssues(image.issues) }));
      } else {
        startUpload(localId);
      }
    },
    [announce, patch, startUpload],
  );

  const processFile = useCallback(
    (localId: string, file: File) => {
      const controller = new AbortController();
      internals.current.set(localId, { controller, source: file });
      patch(localId, {
        status: "processing",
        errorMessage: undefined,
        errorRef: undefined,
      });
      uploader
        .prepare(file, { signal: controller.signal, maxPages: callbacks.current.maxPages })
        .then(({ pages: prepared, trimmed }) => {
          if (isAbort(controller.signal) || prepared.length === 0) return;
          const [first, ...rest] = prepared;
          if (first) settle(localId, first);
          // The rest of a PDF follows the first page, as far as there is room.
          const room = callbacks.current.maxPages - pagesRef.current.length;
          const extra = rest.slice(0, Math.max(0, room));
          if (extra.length > 0) {
            const created = extra.map(() => newLocalId());
            commit((current) => {
              const at = current.findIndex((page) => page.localId === localId) + 1;
              const next = [...current];
              next.splice(at, 0, ...created.map(blankPage));
              return next;
            });
            created.forEach((id, index) => {
              internals.current.set(id, { controller: new AbortController() });
              const image = extra[index];
              if (image) settle(id, image);
            });
          }
          if (trimmed || extra.length < rest.length) {
            toast({
              tone: "info",
              title: t("capture.limit.pdfTrimmed", { count: 1 + extra.length }),
            });
          }
          const n = pagesRef.current.findIndex((page) => page.localId === localId) + 1;
          announce(t("capture.live.added", { n }));
        })
        .catch((error: unknown) => {
          if (isAbort(controller.signal)) return;
          const { message, ref } = failure(error);
          patch(localId, { status: "error", errorMessage: message, errorRef: ref });
          const n = pagesRef.current.findIndex((page) => page.localId === localId) + 1;
          announce(t("capture.live.failed", { n }));
        });
    },
    [announce, commit, patch, settle, toast, uploader],
  );

  // ---- adding ------------------------------------------------------------------------------

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (callbacks.current.disabled || files.length === 0) return;
      const supported = files.filter(isSupportedCaptureFile);
      if (supported.length < files.length) {
        toast({
          tone: "error",
          title: t("capture.drop.refused"),
          description: t("capture.drop.refusedHint"),
        });
      }
      const room = callbacks.current.maxPages - pagesRef.current.length;
      if (supported.length > 0 && room <= 0) {
        toast({
          tone: "info",
          title: t("capture.limit.full", { max: callbacks.current.maxPages }),
          description: t("capture.limit.fullHint"),
        });
        return;
      }
      if (supported.length > room) {
        toast({
          tone: "info",
          title: t("capture.limit.full", { max: callbacks.current.maxPages }),
          description: t("capture.limit.fullHint"),
        });
      }
      for (const file of supported.slice(0, Math.max(0, room))) {
        const localId = newLocalId();
        commit((current) => [...current, blankPage(localId)]);
        processFile(localId, file);
      }
    },
    [commit, processFile, toast],
  );

  const addRemote = useCallback(
    (fileId: string) => {
      if (!handoff || callbacks.current.disabled) return;
      if (pagesRef.current.some((page) => page.fileId === fileId)) return;
      if (pagesRef.current.length >= callbacks.current.maxPages) {
        toast({
          tone: "info",
          title: t("capture.limit.full", { max: callbacks.current.maxPages }),
          description: t("capture.limit.fullHint"),
        });
        return;
      }
      const localId = newLocalId();
      const controller = new AbortController();
      internals.current.set(localId, { controller, remote: true });
      commit((current) => [...current, { ...blankPage(localId), fileId }]);
      handoff
        .adopt(fileId, controller.signal)
        .then(({ previewUrl }) => {
          if (isAbort(controller.signal)) return;
          patch(localId, { previewUrl, status: "uploaded", fileId });
          const n = pagesRef.current.findIndex((page) => page.localId === localId) + 1;
          announce(t("capture.live.addedFromPhone", { n }));
        })
        .catch((error: unknown) => {
          if (isAbort(controller.signal)) return;
          const { message, ref } = failure(error);
          patch(localId, { status: "error", errorMessage: message, errorRef: ref });
        });
    },
    [announce, commit, handoff, patch, toast],
  );

  // Pages that came from the dashboard's quick capture. Through a ref so a new `toast` identity
  // cannot re-run the effect; the cleanup takes them out again so React's strict-mode double
  // mount (whose unmount effect aborts every transfer) adds them afresh instead of skipping them.
  const seedIds = useRef(initialFileIds ?? []);
  const addRemoteRef = useRef(addRemote);
  addRemoteRef.current = addRemote;
  useEffect(() => {
    const ids = seedIds.current;
    const live = internals.current;
    for (const id of ids) addRemoteRef.current(id);
    return () => {
      const seeded = pagesRef.current.filter((page) => page.fileId && ids.includes(page.fileId));
      for (const page of seeded) {
        live.get(page.localId)?.controller.abort();
        live.delete(page.localId);
      }
      if (seeded.length > 0) {
        const gone = new Set(seeded.map((page) => page.localId));
        commit((current) => current.filter((page) => !gone.has(page.localId)));
      }
    };
  }, [commit]);

  // ---- page actions ------------------------------------------------------------------------

  const remove = useCallback(
    (localId: string) => {
      const index = pagesRef.current.findIndex((page) => page.localId === localId);
      if (index === -1) return;
      internals.current.get(localId)?.controller.abort();
      internals.current.delete(localId);
      const url = pagesRef.current[index]?.previewUrl;
      if (url) revoke(url);
      commit((current) => current.filter((page) => page.localId !== localId));
      announce(t("capture.live.removed", { n: index + 1, total: pagesRef.current.length }));
    },
    [announce, commit],
  );

  const move = useCallback(
    (localId: string, delta: number) => {
      const before = pagesRef.current.findIndex((page) => page.localId === localId);
      const next = moveItem(pagesRef.current, localId, delta);
      const after = next.findIndex((page) => page.localId === localId);
      if (before === after) return;
      commit(() => next);
      announce(t("capture.live.moved", { position: after + 1, total: next.length }));
    },
    [announce, commit],
  );

  const retry = useCallback(
    (localId: string) => {
      const entry = internals.current.get(localId);
      if (!entry) return;
      if (entry.image) startUpload(localId);
      else if (entry.source) processFile(localId, entry.source);
    },
    [processFile, startUpload],
  );

  const retake = useCallback(
    (localId: string) => {
      remove(localId);
      pickerRef.current?.click();
    },
    [remove],
  );

  const applyEdit = useCallback(
    (localId: string, blob: Blob) => {
      setEditing(null);
      const entry = internals.current.get(localId);
      if (!entry) return;
      entry.controller.abort();
      const file = new File([blob], "edited.jpg", { type: "image/jpeg" });
      processFile(localId, file);
      announce(
        t("capture.live.replaced", {
          n: pagesRef.current.findIndex((page) => page.localId === localId) + 1,
        }),
      );
    },
    [announce, processFile],
  );

  // ---- window listeners: drop anywhere, paste anywhere -------------------------------------

  useEffect(() => {
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      depth += 1;
      if (depth === 1) {
        setDragging(true);
        announce(t("capture.live.dragging"));
      }
    };
    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      // Without this the browser would open the file instead of dropping it here.
      event.preventDefault();
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(filesFromTransfer(event.dataTransfer));
    };
    const onPaste = (event: ClipboardEvent) => {
      // Text pasted into an input is none of our business: only pasted files count, anywhere.
      const files = filesFromTransfer(event.clipboardData).filter(isSupportedCaptureFile);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [addFiles, announce]);

  // ---- environment: connection, touch, keyboard --------------------------------------------

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      announce(t("capture.live.online"));
    };
    const goOffline = () => {
      setOnline(false);
      announce(t("capture.live.offline"));
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (typeof window.matchMedia === "function") {
      // A phone or tablet: the main pointer is coarse, or any pointer is and there is no mouse
      // hovering. Some Android browsers report "fine" for the main pointer, so also trust touch points.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const anyCoarse = window.matchMedia("(any-pointer: coarse)").matches;
      const mouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      setTouch(coarse || anyCoarse || (navigator.maxTouchPoints > 0 && !mouse));
      setKeyboard(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    }
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [announce]);

  // Free everything on unmount: abort transfers, revoke previews.
  useEffect(() => {
    const live = internals.current;
    return () => {
      for (const entry of live.values()) entry.controller.abort();
      live.clear();
      for (const page of pagesRef.current) revoke(page.previewUrl);
    };
  }, []);

  // ---- phone handoff -----------------------------------------------------------------------

  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffView, setHandoffView] = useState<HandoffView>({ kind: "starting" });
  const sessionId = useRef<string | null>(null);
  const closeFeed = useRef<(() => void) | null>(null);
  const received = useRef(new Set<string>());

  const stopFeed = useCallback(() => {
    closeFeed.current?.();
    closeFeed.current = null;
  }, []);

  const startHandoff = useCallback(() => {
    if (!handoff) return;
    stopFeed();
    received.current = new Set();
    setHandoffOpen(true);
    setHandoffView({ kind: "starting" });
    sessionId.current ??= crypto.randomUUID();
    const captureSessionId = sessionId.current;
    handoff
      .start(captureSessionId)
      .then(async (session) => {
        const qrSrc = await handoff.qr(session.url);
        setHandoffView({
          kind: "waiting",
          url: session.url,
          qrSrc,
          expiresAt: session.expiresAt,
          received: 0,
        });
        closeFeed.current = handoff.subscribe(captureSessionId, (fileId) => {
          if (received.current.has(fileId)) return;
          received.current.add(fileId);
          setHandoffView((current) =>
            current.kind === "waiting" || current.kind === "connected"
              ? { ...current, kind: "connected", received: received.current.size }
              : current,
          );
          addRemote(fileId);
        });
      })
      .catch(() => {
        setHandoffView({ kind: "error" });
      });
  }, [addRemote, handoff, stopFeed]);

  useEffect(() => stopFeed, [stopFeed]);

  const expireHandoff = useCallback(() => {
    stopFeed();
    setHandoffView({ kind: "expired" });
  }, [stopFeed]);

  // ---- derived state -----------------------------------------------------------------------

  const busy = pages.some((page) => page.status === "processing" || page.status === "uploading");
  const warned = pages.filter((page) => page.status === "warning");
  const failed = pages.some((page) => page.status === "error");
  const total = price ? price.perPage * pages.length : 0;
  const insufficient = price !== undefined && total > price.balance;
  const blocker: string | null =
    pages.length === 0
      ? t("capture.analyze.empty")
      : busy
        ? t("capture.analyze.waitUploads")
        : warned.length > 0
          ? t("capture.analyze.fixWarnings")
          : failed
            ? t("capture.analyze.fixErrors")
            : null;
  const full = pages.length >= maxPages;
  const compactLayout = variant !== "full";

  async function analyze() {
    if (!onAnalyze || blocker !== null || insufficient || analyzing) return;
    const ids = pages.map((page) => page.fileId).filter((id): id is string => id !== null);
    setAnalyzing(true);
    try {
      await onAnalyze(ids);
    } catch {
      // The caller shows its own error; the pages stay so the person can try again.
    } finally {
      setAnalyzing(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    // Reset so choosing the same photo again (after a retake) still fires.
    event.target.value = "";
  }

  const editingEntry = editing === null ? undefined : internals.current.get(editing);
  const editingBlob = editingEntry?.image?.blob;
  const canEdit = useMemo(
    () => (localId: string) => {
      const entry = internals.current.get(localId);
      return Boolean(entry?.image) && entry?.remote !== true;
    },
    [],
  );

  const actions: ReactNode = (
    <div
      className={cn(
        "grid gap-2 sm:flex sm:flex-wrap",
        touch ? "grid-cols-2" : "grid-cols-1",
        pages.length === 0 && "sm:justify-center",
      )}
    >
      <Button
        className="whitespace-nowrap px-3 sm:px-5"
        variant={pages.length === 0 ? "primary" : "secondary"}
        size={variant === "full" && pages.length === 0 ? "lg" : "md"}
        disabled={disabled || full}
        onClick={() => pickerRef.current?.click()}
      >
        <ImagePlus aria-hidden className="size-5" />
        {pages.length === 0 ? t("capture.pick") : t("capture.addMore")}
      </Button>
      {touch ? (
        <Button
          className="whitespace-nowrap px-3 sm:px-5"
          variant="secondary"
          size={variant === "full" && pages.length === 0 ? "lg" : "md"}
          disabled={disabled || full}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera aria-hidden className="size-5" />
          {t("capture.camera")}
        </Button>
      ) : null}
      {handoff && !touch ? (
        <Button
          variant="secondary"
          size={variant === "full" && pages.length === 0 ? "lg" : "md"}
          disabled={disabled || full}
          onClick={startHandoff}
        >
          <Smartphone aria-hidden className="size-5" />
          {t("capture.phone")}
        </Button>
      ) : null}
    </div>
  );

  const closeButton: ReactNode = onClose ? (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("capture.close")}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus",
      )}
    >
      <X aria-hidden className="size-5" />
    </button>
  ) : null;

  return (
    <div
      data-variant={variant}
      className={cn("flex flex-col gap-4", variant === "composer" && "gap-2")}
    >
      <DropOverlay visible={dragging} />
      <div role="status" aria-live="polite" className="sr-only" data-testid="capture-live">
        {live}
      </div>

      <input
        ref={pickerRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        data-testid="capture-picker"
        aria-label={t("capture.pick")}
        onChange={onPick}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="capture-camera"
        aria-label={t("capture.camera")}
        onChange={onPick}
      />

      {!online ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4"
        >
          <WifiOff aria-hidden className="mt-1 size-5 shrink-0 text-warning" />
          <div>
            <p className="text-base font-semibold">{t("capture.offline.title")}</p>
            <p className="text-sm text-text-muted">{t("capture.offline.body")}</p>
          </div>
        </div>
      ) : null}

      {pages.length === 0 ? (
        collapsed ? null : (
          <div
            className={cn(
              "relative flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-neutral-400 bg-surface text-center",
              compactLayout ? "p-3 sm:p-5" : "p-3 sm:p-12",
            )}
          >
            {onClose ? (
              <div className="-mt-1 -me-1 flex w-full justify-end">{closeButton}</div>
            ) : null}
            {variant !== "composer" ? (
              <>
                <span className="inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <ImagePlus aria-hidden className="size-7" />
                </span>
                <h2 className="font-heading text-xl font-semibold">{t("capture.empty.title")}</h2>
                <p className="max-w-md text-base text-text-muted">
                  {t("capture.empty.hint", { max: maxPages })}
                </p>
              </>
            ) : null}
            {actions}
            <p className="text-sm text-text-muted">
              {t("capture.dropZone")}
              {keyboard ? ` · ${t("capture.pasteHint")}` : null}
            </p>
          </div>
        )
      ) : (
        <>
          <PageTray
            pages={pages}
            maxPages={maxPages}
            compact={compactLayout}
            onMove={move}
            onRemove={remove}
            onEdit={setEditing}
            canEdit={canEdit}
            onRetry={retry}
          />
          {warned.map((page) => (
            <QualityHint
              key={page.localId}
              n={pages.indexOf(page) + 1}
              issues={page.quality.issues}
              previewUrl={page.previewUrl}
              onRetake={() => {
                retake(page.localId);
              }}
              onContinue={() => {
                startUpload(page.localId);
              }}
            />
          ))}
          {collapsed ? null : (
            <div className="flex flex-col gap-1">
              {onClose ? <div className="flex justify-end">{closeButton}</div> : null}
              {actions}
            </div>
          )}
          {keyboard && variant !== "composer" && !collapsed ? (
            <p className="text-sm text-text-muted">{t("capture.pasteHint")}</p>
          ) : null}
        </>
      )}

      {onAnalyze && variant !== "composer" ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4" data-testid="analyze-bar">
          {price ? (
            <p className="text-sm text-text-muted tabular-nums">
              {t("capture.analyze.balance", { balance: price.balance })}
            </p>
          ) : null}
          {insufficient && price ? (
            <div role="alert" className="flex flex-col gap-2">
              <p className="text-base font-semibold text-danger">
                {t("capture.analyze.insufficient")}
              </p>
              <p className="text-sm text-text-muted">
                {t("capture.analyze.insufficientBody", {
                  price: total,
                  balance: price.balance,
                })}
              </p>
              <a href={supportHref} className={buttonStyles({ variant: "secondary" })}>
                {t("capture.analyze.support")}
              </a>
            </div>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                loading={analyzing}
                disabled={disabled || blocker !== null}
                aria-describedby={blocker !== null ? "capture-analyze-blocker" : undefined}
                onClick={() => {
                  void analyze();
                }}
              >
                {analyzing
                  ? t("capture.analyze.working")
                  : price && total > 0
                    ? t("capture.analyze.button", { price: total })
                    : t("capture.analyze.free")}
              </Button>
              {blocker !== null && pages.length > 0 ? (
                <p id="capture-analyze-blocker" className="text-sm text-text-muted">
                  {blocker}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {editing !== null && editingBlob ? (
        <Suspense fallback={null}>
          <ImageEditor
            blob={editingBlob}
            onCancel={() => {
              setEditing(null);
            }}
            onApply={(blob) => {
              applyEdit(editing, blob);
            }}
          />
        </Suspense>
      ) : null}

      {handoff ? (
        <PhoneHandoff
          open={handoffOpen}
          view={handoffView}
          max={HANDOFF_MAX}
          onRenew={startHandoff}
          onClose={() => {
            setHandoffOpen(false);
            // Pages still arrive while the code is valid; the feed stays until it is renewed or expires.
          }}
          onExpire={expireHandoff}
        />
      ) : null}
    </div>
  );
}
