"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { RotateCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../button";
import { Dialog } from "../dialog";

import {
  NO_CROP,
  adjustInset,
  cropRect,
  fitLongEdge,
  keyToInsetDelta,
  rotatedSize,
  type CropEdge,
  type CropInsets,
} from "./crop";

import type { KeyboardEvent, PointerEvent } from "react";

const EDGES: readonly CropEdge[] = ["top", "right", "bottom", "left"];

const EDGE_LABELS: Record<CropEdge, MessageKey> = {
  top: "capture.editor.crop.top",
  right: "capture.editor.crop.right",
  bottom: "capture.editor.crop.bottom",
  left: "capture.editor.crop.left",
};

/** Largest long edge of an edited page; the same as what the pipeline produces. */
const OUTPUT_LONG_EDGE = 2048;
const OUTPUT_QUALITY = 0.85;
const PREVIEW_LONG_EDGE = 640;

export interface ImageEditorProps {
  /** The page as it is now (a JPEG). */
  blob: Blob;
  /** The edited page, JPEG. The caller runs it through the same pipeline as any new photo. */
  onApply: (blob: Blob) => void;
  onCancel: () => void;
}

function drawRotated(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  quarterTurns: number,
  longEdge: number,
): void {
  const turned = rotatedSize(bitmap.width, bitmap.height, quarterTurns);
  const size = fitLongEdge(turned.width, turned.height, longEdge);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.translate(size.width / 2, size.height / 2);
  context.rotate((quarterTurns * Math.PI) / 2);
  const drawn = fitLongEdge(bitmap.width, bitmap.height, longEdge);
  const scale = drawn.width / bitmap.width;
  context.scale(scale, scale);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  context.restore();
}

/**
 * Rotate by quarter turns and crop with four edge handles. Each handle is a `slider` that moves
 * with the arrow keys (Shift = bigger steps) and with the pointer, so the crop works without a
 * mouse. Loaded lazily: most photos need no editing.
 */
export function ImageEditor({ blob, onApply, onCancel }: ImageEditorProps) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [turns, setTurns] = useState(0);
  const [crop, setCrop] = useState<CropInsets>(NO_CROP);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: ImageBitmap | null = null;
    createImageBitmap(blob)
      .then((value) => {
        if (cancelled) {
          value.close();
          return;
        }
        loaded = value;
        setBitmap(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      loaded?.close();
    };
  }, [blob]);

  useEffect(() => {
    if (bitmap && canvasRef.current) {
      drawRotated(canvasRef.current, bitmap, turns, PREVIEW_LONG_EDGE);
    }
  }, [bitmap, turns]);

  const move = useCallback((edge: CropEdge, delta: number) => {
    setCrop((current) => adjustInset(current, edge, delta));
  }, []);

  function onKeyDown(edge: CropEdge, event: KeyboardEvent<HTMLDivElement>) {
    const delta = keyToInsetDelta(edge, event.key, event.shiftKey ? 0.05 : 0.01);
    if (delta === null) return;
    event.preventDefault();
    move(edge, delta);
  }

  function onPointerMove(edge: CropEdge, event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame || frame.width === 0 || frame.height === 0) return;
    const fromLeft = (event.clientX - frame.left) / frame.width;
    const fromTop = (event.clientY - frame.top) / frame.height;
    const target =
      edge === "left"
        ? fromLeft
        : edge === "right"
          ? 1 - fromLeft
          : edge === "top"
            ? fromTop
            : 1 - fromTop;
    setCrop((current) => adjustInset(current, edge, target - current[edge]));
  }

  function apply() {
    if (!bitmap) return;
    const turned = rotatedSize(bitmap.width, bitmap.height, turns);
    const source = document.createElement("canvas");
    drawRotated(source, bitmap, turns, Math.max(turned.width, turned.height));
    const rect = cropRect(crop, source.width, source.height);
    const out = fitLongEdge(rect.width, rect.height, OUTPUT_LONG_EDGE);
    const target = document.createElement("canvas");
    target.width = out.width;
    target.height = out.height;
    const context = target.getContext("2d");
    if (!context) {
      setFailed(true);
      return;
    }
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height);
    target.toBlob(
      (result) => {
        if (result) onApply(result);
        else setFailed(true);
      },
      "image/jpeg",
      OUTPUT_QUALITY,
    );
  }

  const edited = turns !== 0 || EDGES.some((edge) => crop[edge] !== 0);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("capture.editor.title")}
      description={t("capture.editor.hint")}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("capture.editor.cancel")}
          </Button>
          <Button variant="primary" disabled={!bitmap || !edited} onClick={apply}>
            {t("capture.editor.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {failed ? (
          <p role="alert" className="text-base text-danger">
            {t("capture.editor.failed")}
          </p>
        ) : null}
        {/* The picture is not mirrored in RTL, so the frame is LTR and the handles are physical. */}
        <div
          ref={frameRef}
          dir="ltr"
          className="relative max-w-full touch-none select-none overflow-hidden rounded-lg bg-neutral-100"
        >
          <canvas ref={canvasRef} className="block max-h-[50vh] max-w-full" />
          {bitmap ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(11,18,32,0.45)]"
              style={{
                insetInlineStart: `${crop.left * 100}%`,
                insetInlineEnd: `${crop.right * 100}%`,
                top: `${crop.top * 100}%`,
                bottom: `${crop.bottom * 100}%`,
              }}
            />
          ) : null}
          {bitmap
            ? EDGES.map((edge) => {
                const horizontal = edge === "top" || edge === "bottom";
                return (
                  <div
                    key={edge}
                    role="slider"
                    tabIndex={0}
                    aria-label={t(EDGE_LABELS[edge])}
                    aria-orientation={horizontal ? "vertical" : "horizontal"}
                    aria-valuemin={0}
                    aria-valuemax={90}
                    aria-valuenow={Math.round(crop[edge] * 100)}
                    aria-valuetext={`${Math.round(crop[edge] * 100)}%`}
                    data-edge={edge}
                    onKeyDown={(event) => {
                      onKeyDown(edge, event);
                    }}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                      onPointerMove(edge, event);
                    }}
                    className="absolute flex items-center justify-center focus-visible:outline-none"
                    style={
                      horizontal
                        ? {
                            insetInlineStart: "50%",
                            [edge]: `${crop[edge] * 100}%`,
                            transform: "translate(-50%, " + (edge === "top" ? "-50%" : "50%") + ")",
                            width: 64,
                            height: 44,
                            cursor: "ns-resize",
                          }
                        : {
                            top: "50%",
                            insetInlineStart: edge === "left" ? `${crop.left * 100}%` : undefined,
                            insetInlineEnd: edge === "right" ? `${crop.right * 100}%` : undefined,
                            transform:
                              "translate(" + (edge === "left" ? "-50%" : "50%") + ", -50%)",
                            width: 44,
                            height: 64,
                            cursor: "ew-resize",
                          }
                    }
                  >
                    <span
                      className={
                        "block rounded-full bg-primary ring-2 ring-surface " +
                        (horizontal ? "h-1.5 w-10" : "h-10 w-1.5")
                      }
                    />
                  </div>
                );
              })
            : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            disabled={!bitmap}
            onClick={() => {
              setTurns((value) => (value + 1) % 4);
              setCrop(NO_CROP);
            }}
          >
            <RotateCw aria-hidden className="size-5" />
            {t("capture.editor.rotate")}
          </Button>
          <Button
            variant="ghost"
            disabled={!edited}
            onClick={() => {
              setTurns(0);
              setCrop(NO_CROP);
            }}
          >
            <Undo2 aria-hidden className="size-5 rtl:-scale-x-100" />
            {t("capture.editor.reset")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
