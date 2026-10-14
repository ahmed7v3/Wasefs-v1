"use client";

import { t } from "@wasfa/shared/i18n";
import { Check, Copy, Smartphone, TimerOff, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../button";
import { Dialog } from "../dialog";
import { Spinner } from "../spinner";

export type HandoffView =
  | { kind: "starting" }
  | {
      /** `waiting` until the first phone page arrives, then `connected`. */
      kind: "waiting" | "connected";
      url: string;
      /** QR image source (a data URL); the link is shown as text either way. */
      qrSrc: string | undefined;
      expiresAt: string;
      received: number;
    }
  | { kind: "expired" }
  | { kind: "error" };

export interface PhoneHandoffProps {
  open: boolean;
  view: HandoffView;
  /** Pages one code may add. */
  max: number;
  onRenew: () => void;
  onClose: () => void;
  /** The countdown reached zero. */
  onExpire: () => void;
}

/** `4:32`, Western digits. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function Countdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.ceil((new Date(expiresAt).getTime() - now) / 1000);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (remaining <= 0) onExpire();
  }, [remaining, onExpire]);

  return (
    <p className="text-sm text-text-muted">
      {t("capture.handoff.expiresIn", { time: "" })}
      <bdi className="font-semibold tabular-nums text-text">{formatCountdown(remaining)}</bdi>
    </p>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? <Check aria-hidden className="size-5" /> : <Copy aria-hidden className="size-5" />}
      {copied ? t("capture.handoff.copied") : t("capture.handoff.copy")}
    </Button>
  );
}

/**
 * Desktop to phone: a QR code for a five minute link, with the states a person actually sees
 * (creating, waiting, pages arriving, expired, failed). The phone adds pages only; nothing is
 * analysed until Analyze is pressed on this device, and the dialog says so.
 */
export function PhoneHandoff({ open, view, max, onRenew, onClose, onExpire }: PhoneHandoffProps) {
  const live = view.kind === "waiting" || view.kind === "connected";
  const full = view.kind === "connected" && view.received >= max;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("capture.handoff.title")}
      description={view.kind === "expired" ? undefined : t("capture.handoff.body")}
      actions={
        <>
          {view.kind === "expired" || view.kind === "error" ? (
            <Button variant="primary" onClick={onRenew}>
              {t("capture.handoff.renew")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {t("capture.handoff.close")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center" data-state={view.kind}>
        {view.kind === "starting" ? (
          <p className="flex items-center gap-2 text-base text-text-muted" role="status">
            <Spinner />
            {t("capture.handoff.starting")}
          </p>
        ) : null}
        {live ? (
          <>
            {view.qrSrc ? (
              <img
                src={view.qrSrc}
                alt={t("capture.handoff.qrAlt")}
                width={208}
                height={208}
                className="size-52 rounded-lg border border-border bg-surface p-2"
              />
            ) : (
              <span className="inline-flex size-52 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Smartphone aria-hidden className="size-16" />
              </span>
            )}
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-text-muted">{t("capture.handoff.link")}</p>
              <bdi className="max-w-full break-all text-sm text-text" dir="ltr">
                {view.url}
              </bdi>
              <CopyLink url={view.url} />
            </div>
            <p role="status" className="text-base font-semibold text-primary">
              {full
                ? t("capture.handoff.full", { max })
                : view.kind === "connected"
                  ? t("capture.handoff.connected", { count: view.received, max })
                  : t("capture.handoff.waiting")}
            </p>
            <Countdown expiresAt={view.expiresAt} onExpire={onExpire} />
            <p className="text-sm text-text-muted">{t("capture.handoff.note")}</p>
          </>
        ) : null}
        {view.kind === "expired" ? (
          <div role="status" className="flex flex-col items-center gap-2">
            <TimerOff aria-hidden className="size-10 text-warning" />
            <p className="font-heading text-lg font-semibold">
              {t("capture.handoff.expired.title")}
            </p>
            <p className="text-base text-text-muted">{t("capture.handoff.expired.body")}</p>
          </div>
        ) : null}
        {view.kind === "error" ? (
          <p role="alert" className="flex items-center gap-2 text-base text-danger">
            <TriangleAlert aria-hidden className="size-5" />
            {t("capture.handoff.failed")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
