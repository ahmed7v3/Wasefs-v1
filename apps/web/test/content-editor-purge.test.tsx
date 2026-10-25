// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it, vi } from "vitest";

import {
  PurgeDialog,
  purgeConfirmMatches,
} from "../src/components/admin/content-editor/action-dialogs";

describe("purgeConfirmMatches", () => {
  it("needs the exact title, ignoring surrounding spaces only", () => {
    expect(purgeConfirmMatches("عنوان المقال", "عنوان المقال")).toBe(true);
    expect(purgeConfirmMatches("  عنوان المقال ", "عنوان المقال")).toBe(true);
    expect(purgeConfirmMatches("عنوان", "عنوان المقال")).toBe(false);
    expect(purgeConfirmMatches("", "عنوان المقال")).toBe(false);
  });
});

describe("PurgeDialog", () => {
  it("unlocks the button only when the title is typed, then confirms", async () => {
    const onConfirm = vi.fn().mockResolvedValue("ok");
    const onClose = vi.fn();
    render(
      <PurgeDialog
        open
        onClose={onClose}
        title="My title"
        busy={false}
        error={null}
        onConfirm={onConfirm}
      />,
    );
    const button = screen.getByRole("button", { name: t("admin.editor.action.purge") });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(t("admin.editor.purge.confirmLabel")), "My title");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
