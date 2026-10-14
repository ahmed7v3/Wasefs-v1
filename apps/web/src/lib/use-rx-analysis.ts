"use client";

import { rxViewSchema, type RxView } from "@wasfa/shared/schemas/rx";
import { useCallback, useEffect, useReducer, useState } from "react";

import { api } from "./api-client";
import {
  POLL_INTERVAL_MS,
  elapsedSeconds,
  initialProgress,
  isTerminal,
  progressReducer,
  reconnectDelayMs,
  type RxProgressState,
} from "./rx-progress";
import { streamRxEvents } from "./rx-stream";

export interface RxAnalysis {
  view: RxView;
  progress: RxProgressState;
  /** Seconds since the analysis was queued; `undefined` until the page is mounted (no clock on the server). */
  elapsed: number | undefined;
  /** Fetching the finished result failed. */
  loadError: unknown;
  retryLoad: () => void;
}

/**
 * One analysis on screen. While it runs it follows the live stream, reconnects with a short back-off
 * when the connection drops or the tab returns, and falls back to polling `GET /rx/:id` every 2 s
 * after repeated drops. When it ends it fetches the finished row (the result and the error ref).
 */
export function useRxAnalysis(initial: RxView): RxAnalysis {
  const id = initial.id;
  const [view, setView] = useState(initial);
  const [progress, dispatch] = useReducer(progressReducer, initial, (row) =>
    initialProgress(row.status, row.errorRef),
  );
  const [now, setNow] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadTick, setLoadTick] = useState(0);

  const running = progress.phase === "running";
  const { transport, attempts, epoch } = progress;

  // The clock of "elapsed time": a second at a time, only while the analysis runs.
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  // Coming back to the tab, or the network returning, is the moment to try the live stream again.
  useEffect(() => {
    if (!running) return;
    const resume = () => {
      if (document.visibilityState === "visible") dispatch({ type: "resume" });
    };
    const online = () => {
      dispatch({ type: "resume" });
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", online);
    };
  }, [running]);

  // The live stream, or the polling fallback.
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (transport === "polling") {
      const poll = async () => {
        try {
          const row = await api(`/rx/${id}`, { schema: rxViewSchema, signal });
          if (signal.aborted) return;
          setView(row);
          dispatch({ type: "snapshot", status: row.status, errorRef: row.errorRef });
        } catch {
          // A failed poll is just a missed beat; the next one tries again.
        }
        if (!signal.aborted) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      };
      void poll();
    } else {
      timer = setTimeout(() => {
        streamRxEvents(id, signal, (event) => {
          dispatch({ type: "event", event });
        }).then(
          () => {
            if (!signal.aborted) dispatch({ type: "dropped" });
          },
          () => {
            if (!signal.aborted) dispatch({ type: "dropped" });
          },
        );
      }, reconnectDelayMs(attempts));
    }
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, running, transport, attempts, epoch]);

  // The analysis ended: get the finished row (result, error ref) unless it is already in hand.
  const needsRow =
    isTerminal(progress.phase) &&
    (view.status !== progress.phase || (progress.phase === "done" && view.result === null));
  useEffect(() => {
    if (!needsRow) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    api(`/rx/${id}`, { schema: rxViewSchema, signal: controller.signal }).then(
      (row) => {
        setLoadError(null);
        setView(row);
        // The event can beat the commit by a moment: look again until the row says the same.
        if (!isTerminal(initialProgress(row.status).phase)) {
          timer = setTimeout(() => {
            setLoadTick((tick) => tick + 1);
          }, 1000);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error);
      },
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [needsRow, id, loadTick]);

  const retryLoad = useCallback(() => {
    setLoadError(null);
    setLoadTick((tick) => tick + 1);
  }, []);

  return {
    view,
    progress,
    elapsed: now === null ? undefined : elapsedSeconds(view.queuedAt, now),
    loadError,
    retryLoad,
  };
}
