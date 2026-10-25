import type { TextState } from "./toolbar";

/** The smallest single replacement that turns `a` into `b`: `a[start, end)` becomes `insert`. */
export function minimalEdit(a: string, b: string): { start: number; end: number; insert: string } {
  let start = 0;
  const shortest = Math.min(a.length, b.length);
  while (start < shortest && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return { start, end: endA, insert: b.slice(start, endB) };
}

/**
 * Writes a computed `TextState` into a textarea so the browser's own undo stack keeps working:
 * `execCommand("insertText")` is the only way to make Ctrl+Z undo a programmatic edit. Where it is
 * missing or refuses (jsdom, some mobile WebViews) `setRangeText` plus an `input` event is the fallback;
 * React's `onChange` fires from either path. The selection is set last.
 */
export function commitTextState(element: HTMLTextAreaElement, next: TextState): void {
  const current = element.value;
  if (current !== next.value) {
    const { start, end, insert } = minimalEdit(current, next.value);
    element.setSelectionRange(start, end);
    let done = false;
    try {
      if (typeof document.execCommand === "function") {
        done =
          insert === ""
            ? document.execCommand("delete")
            : document.execCommand("insertText", false, insert);
      }
    } catch {
      done = false;
    }
    if (!done || element.value !== next.value) {
      element.setRangeText(insert, start, end, "end");
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  element.setSelectionRange(next.selStart, next.selEnd);
}

const MIRRORED_STYLES = [
  "boxSizing",
  "width",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "textAlign",
  "textIndent",
  "tabSize",
  "direction",
  "unicodeBidi",
] as const;

/**
 * Vertical position (px from the textarea's top edge) of the line holding `offset`, measured with a
 * hidden copy of the textarea laid out the same way. A textarea cannot report where a character is, and
 * the editor needs it to scroll a heading into view and to anchor the slash-command list at the caret.
 */
export function measureOffsetTop(element: HTMLTextAreaElement, offset: number): number {
  const computed = getComputedStyle(element);
  const probe = document.createElement("div");
  for (const name of MIRRORED_STYLES) probe.style[name] = computed[name];
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.top = "0";
  probe.style.insetInlineStart = "-9999px";
  probe.style.whiteSpace = "pre-wrap";
  probe.style.overflowWrap = "break-word";
  probe.setAttribute("dir", element.getAttribute("dir") ?? "auto");
  probe.textContent = element.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = "​";
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const top = marker.offsetTop;
  probe.remove();
  return top;
}
