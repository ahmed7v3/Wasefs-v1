"use client";

import { useSyncExternalStore } from "react";

/*
 * The one flag that keeps an upgrade prompt away from a person who is busy: set while pages are being
 * added, uploaded or analysed on /analyze (conversion-prompts spec, "calm moments only"). A modal
 * checks it when its answer arrives and never opens while it is set.
 */

let busy = false;
const listeners = new Set<() => void>();

export function setGrowthBusy(value: boolean): void {
  if (busy === value) return;
  busy = value;
  for (const listener of listeners) listener();
}

export function isGrowthBusy(): boolean {
  return busy;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive read of the flag. */
export function useGrowthBusy(): boolean {
  return useSyncExternalStore(subscribe, isGrowthBusy, () => false);
}
