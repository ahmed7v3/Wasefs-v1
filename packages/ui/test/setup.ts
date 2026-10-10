import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

// jsdom has no <dialog>.showModal()/close(): emulate what a browser does, including Esc firing a
// cancelable `cancel` event and `close` firing after the dialog closes.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !this.open) {
        return;
      }
      const cancel = new Event("cancel", { cancelable: true });
      this.dispatchEvent(cancel);
      if (!cancel.defaultPrevented) {
        this.close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    this.addEventListener("close", () => document.removeEventListener("keydown", onKeyDown), {
      once: true,
    });
  };
}

if (typeof HTMLDialogElement.prototype.close !== "function") {
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) {
      return;
    }
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
