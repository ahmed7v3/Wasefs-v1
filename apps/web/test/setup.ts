import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  // Only jsdom files mount anything; the plain Node ones have no document to clean.
  if (typeof document !== "undefined") cleanup();
});

// jsdom has no <dialog>.showModal()/close(); emulate the open state and the `close` event.
if (
  typeof HTMLDialogElement !== "undefined" &&
  typeof HTMLDialogElement.prototype.showModal !== "function"
) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
