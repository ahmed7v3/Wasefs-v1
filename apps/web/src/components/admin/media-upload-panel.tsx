"use client";

import { t } from "@wasfa/shared/i18n";
import { MEDIA_MAX_BYTES, MEDIA_MIMES, type MediaAsset } from "@wasfa/shared/schemas/media";
import { Button, cn } from "@wasfa/ui";
import { Camera, ImagePlus, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { tOr } from "../../lib/admin-format";
import { uploadMediaFile, type UploadState } from "../../lib/media-upload-client";
import { errorMessage } from "../error-notice";

const ACCEPT = MEDIA_MIMES.join(",");

interface QueueEntry {
  id: number;
  name: string;
  state: UploadState;
}

/** The sentence for the end state of one upload: a pre-check, a rejection reason or an API error. */
export function uploadProblemMessage(state: UploadState): string | null {
  if (state.phase === "rejected") {
    return tOr(
      `admin.media.reject.${state.asset?.rejectReason ?? "unknown"}`,
      t("admin.media.reject.unknown"),
    );
  }
  if (state.phase === "failed") {
    if (typeof state.error === "string" && state.error.startsWith("precheck:")) {
      return tOr(
        `admin.media.precheck.${state.error.slice("precheck:".length)}`,
        t("admin.media.reject.unknown"),
        { max: Math.round(MEDIA_MAX_BYTES / 1024 / 1024) },
      );
    }
    return errorMessage(state.error);
  }
  if (state.phase === "timeout") return t("admin.media.timeout");
  return null;
}

export interface MediaUploadPanelProps {
  /** Called once per file that ended `ready`. */
  onReady: (asset: MediaAsset) => void;
  /** Called for every finished file, whatever the outcome (the library refreshes its list). */
  onSettled?: (() => void) | undefined;
}

/**
 * Upload surface of the media library: drag and drop, a file picker, camera capture on phones and paste
 * from the clipboard. Files go one at a time through `uploadMediaFile` (hash, presigned PUT, commit, poll).
 */
export function MediaUploadPanel({ onReady, onSettled }: MediaUploadPanelProps) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const counter = useRef(0);
  // Files wait here so only one upload runs at a time.
  const pending = useRef<{ id: number; file: File }[]>([]);
  const running = useRef(false);
  const fileInput = useId();
  const cameraInput = useId();
  const onReadyRef = useRef(onReady);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onReadyRef.current = onReady;
    onSettledRef.current = onSettled;
  });

  const update = useCallback((id: number, state: UploadState) => {
    setQueue((current) => current.map((entry) => (entry.id === id ? { ...entry, state } : entry)));
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    for (let next = pending.current.shift(); next; next = pending.current.shift()) {
      const { id, file } = next;
      const final = await uploadMediaFile(file, {
        onPhase: (state) => {
          update(id, state);
        },
      });
      if (final.phase === "ready" && final.asset) onReadyRef.current(final.asset);
      onSettledRef.current?.();
    }
    running.current = false;
  }, [update]);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const entries = files.map((file) => {
        counter.current += 1;
        return { id: counter.current, file };
      });
      setQueue((current) => [
        ...current,
        ...entries.map(({ id, file }) => ({
          id,
          name: file.name,
          state: { phase: "hashing" } as UploadState,
        })),
      ]);
      pending.current.push(...entries);
      void drain();
    },
    [drain],
  );

  // Paste an image from the clipboard anywhere while the panel is on screen.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("paste", onPaste);
    };
  }, [addFiles]);

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center",
          dragging ? "border-primary bg-primary-soft" : "border-border bg-surface",
        )}
      >
        <Upload aria-hidden className="size-8 text-primary" />
        <p className="text-base text-text">{t("admin.media.upload.drop")}</p>
        <p className="text-sm text-text-muted">
          {t("admin.media.upload.rules", { max: Math.round(MEDIA_MAX_BYTES / 1024 / 1024) })}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <input
            id={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            aria-label={t("admin.media.upload.pick")}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            onClick={() => {
              document.getElementById(fileInput)?.click();
            }}
          >
            <ImagePlus aria-hidden className="size-5" />
            {t("admin.media.upload.pick")}
          </Button>
          <input
            id={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={t("admin.media.upload.camera")}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Button
            variant="secondary"
            className="md:hidden"
            onClick={() => {
              document.getElementById(cameraInput)?.click();
            }}
          >
            <Camera aria-hidden className="size-5" />
            {t("admin.media.upload.camera")}
          </Button>
        </div>
        <p className="text-sm text-text-muted">{t("admin.media.upload.paste")}</p>
      </div>

      <ul aria-live="polite" className="flex flex-col gap-2">
        {queue.map((entry) => {
          const problem = uploadProblemMessage(entry.state);
          return (
            <li
              key={entry.id}
              className="flex flex-col gap-0.5 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="break-all font-semibold text-text">{entry.name}</span>
              <span className={problem ? "text-danger" : "text-text-muted"}>
                {problem ?? t(`admin.media.phase.${entry.state.phase}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
