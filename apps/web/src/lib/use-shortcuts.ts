"use client";

import { useEffect, useRef } from "react";

/** One handler per physical letter key (`"j"`, `"a"`): matched on `event.code`, so an Arabic layout works too. */
export type ShortcutMap = Readonly<Record<string, () => void>>;

/** True for the places where a letter is text, not a command: fields, editable areas, selects. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** The shortcut letter of a key event, or `null` for anything that is not a plain letter press. */
export function shortcutLetter(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const match = /^Key([A-Z])$/.exec(event.code);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/**
 * Keyboard shortcuts of a queue (J/K to move, A/R/C/S to act). They are ignored while typing in a
 * field, with a modifier held, while a modal dialog is open, and while `enabled` is false.
 */
export function useShortcuts(map: ShortcutMap, enabled = true): void {
  // The latest map without re-binding the listener on every render.
  const latest = useRef(map);
  latest.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isTypingTarget(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      const letter = shortcutLetter(event);
      const handler = letter ? latest.current[letter] : undefined;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled]);
}
