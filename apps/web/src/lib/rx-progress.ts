import { RX_STEPS, type RxEvent } from "@wasfa/shared/schemas/rx";

import type { RxStatus } from "@wasfa/shared/rx";

/*
 * What the progress screen knows about a running analysis. Pure, so reconnecting and the polling
 * fallback are tested without a network: the hook (`use-rx-analysis.ts`) only turns what happens on
 * the wire into these actions.
 */

export type RxPhase = "running" | "done" | "refunded" | "failed";
export type RxTransport = "sse" | "polling";

/** Consecutive dropped streams before the page falls back to polling `GET /rx/:id`. */
export const MAX_RECONNECTS = 3;
/** The polling cadence of the fallback. */
export const POLL_INTERVAL_MS = 2000;
/** Wait before reconnecting after the nth consecutive drop (1 s, 2 s, ...). */
export const reconnectDelayMs = (attempts: number): number =>
  attempts <= 0 ? 0 : 1000 * 2 ** Math.min(attempts - 1, 3);

export interface RxProgressState {
  phase: RxPhase;
  /** Index into `RX_STEPS` of the step in progress; never moves backwards. */
  step: number;
  /** Highest event `seq` applied, so a replayed or late event is ignored. */
  seq: number;
  errorRef: string | null;
  transport: RxTransport;
  /** Consecutive dropped streams since the last event. */
  attempts: number;
  /** Bumped to force a new stream (the tab came back, the network returned). */
  epoch: number;
}

export type RxProgressAction =
  | { type: "event"; event: RxEvent }
  /** The row as `GET /rx/:id` returns it (polling, or the refetch after a terminal event). */
  | { type: "snapshot"; status: RxStatus; errorRef: string | null }
  /** The stream ended or failed without a terminal event. */
  | { type: "dropped" }
  /** The tab became visible or the network returned: try the live stream again. */
  | { type: "resume" };

const PHASE_OF: Record<RxStatus, RxPhase> = {
  queued: "running",
  processing: "running",
  verifying: "running",
  done: "done",
  refunded: "refunded",
  failed: "failed",
};

const VERIFY_STEP = RX_STEPS.indexOf("verify");

export const isTerminal = (phase: RxPhase): boolean => phase !== "running";

export function initialProgress(status: RxStatus, errorRef: string | null = null): RxProgressState {
  return {
    phase: PHASE_OF[status],
    step: status === "verifying" ? VERIFY_STEP : 0,
    seq: -1,
    errorRef: status === "failed" ? errorRef : null,
    transport: "sse",
    attempts: 0,
    epoch: 0,
  };
}

export function progressReducer(state: RxProgressState, action: RxProgressAction): RxProgressState {
  // An ended analysis stays ended: nothing that arrives later can reopen it.
  if (isTerminal(state.phase)) return state;
  switch (action.type) {
    case "event": {
      const { event } = action;
      // Terminal events always apply; a step that is not newer than what was seen does not.
      if (event.type === "step") {
        // A replay of the last event (what a reconnect starts with) still proves the stream is alive.
        if (event.seq <= state.seq) {
          return state.attempts === 0 ? state : { ...state, attempts: 0 };
        }
        return {
          ...state,
          seq: event.seq,
          step: Math.max(state.step, RX_STEPS.indexOf(event.step)),
          attempts: 0,
          transport: "sse",
        };
      }
      if (event.type === "done") {
        return { ...state, phase: event.status, seq: Math.max(state.seq, event.seq), attempts: 0 };
      }
      return {
        ...state,
        phase: "failed",
        seq: Math.max(state.seq, event.seq),
        errorRef: event.errorRef === "" ? null : event.errorRef,
        attempts: 0,
      };
    }
    case "snapshot": {
      const phase = PHASE_OF[action.status];
      return {
        ...state,
        phase,
        step: action.status === "verifying" ? Math.max(state.step, VERIFY_STEP) : state.step,
        errorRef: phase === "failed" ? action.errorRef : state.errorRef,
      };
    }
    case "dropped": {
      const attempts = state.attempts + 1;
      return {
        ...state,
        attempts,
        transport: attempts >= MAX_RECONNECTS ? "polling" : state.transport,
      };
    }
    case "resume":
      return { ...state, transport: "sse", attempts: 0, epoch: state.epoch + 1 };
  }
}

/** Whole seconds between the start and now (never negative). */
export function elapsedSeconds(startIso: string, nowMs: number): number {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}
