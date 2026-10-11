// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../src/components/admin/confirm-dialog";
import { ApiRequestError } from "../src/lib/api-error";
import { ReauthProvider } from "../src/lib/reauth";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reauthRequired = () =>
  new ApiRequestError("AUTH_REQUIRED", "x", undefined, 401, { reason: "reauth" });

const reasonField = () => screen.getByLabelText(new RegExp(`^${t("admin.reason.label")}`));

function setup(onConfirm: (reason: string) => Promise<void>, withReason = true) {
  const onOpenChange = vi.fn();
  render(
    <ReauthProvider>
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Suspend Sara"
        confirmLabel="Suspend"
        tone="danger"
        withReason={withReason}
        onConfirm={onConfirm}
      />
    </ReauthProvider>,
  );
  return onOpenChange;
}

describe("ConfirmDialog with a reason", () => {
  it("refuses a reason shorter than 5 characters and does not call the API", async () => {
    const onConfirm = vi.fn<(reason: string) => Promise<void>>().mockResolvedValue(undefined);
    setup(onConfirm);
    await userEvent.type(reasonField(), "four");
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByText(t("form.tooShort", { min: 5 }))).toBeTruthy();
    expect(reasonField().getAttribute("aria-invalid")).toBe("true");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("refuses a reason that is only spaces", async () => {
    const onConfirm = vi.fn<(reason: string) => Promise<void>>().mockResolvedValue(undefined);
    setup(onConfirm);
    await userEvent.type(reasonField(), "        ");
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByText(t("form.required"))).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason and closes on success", async () => {
    const onConfirm = vi.fn<(reason: string) => Promise<void>>().mockResolvedValue(undefined);
    const onOpenChange = setup(onConfirm);
    await userEvent.type(reasonField(), "  Abuse reported twice  ");
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onConfirm).toHaveBeenCalledWith("Abuse reported twice");
  });

  it("replays the write once after the password is re-entered", async () => {
    const onConfirm = vi
      .fn<(reason: string) => Promise<void>>()
      .mockRejectedValueOnce(reauthRequired())
      .mockResolvedValueOnce(undefined);
    fetchMock.mockResolvedValue(json({ reauthAt: "2026-10-11T10:00:00.000Z" }));
    const onOpenChange = setup(onConfirm);

    await userEvent.type(reasonField(), "Abuse reported twice");
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));

    const password = await screen.findByLabelText(new RegExp(`^${t("auth.field.password")}`));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.type(password, "my current password");
    await userEvent.click(screen.getByRole("button", { name: t("auth.reauth.confirm") }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });
    expect(onConfirm).toHaveBeenNthCalledWith(2, "Abuse reported twice");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/auth\/reauth$/);
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("keeps the dialog open and shows the API's reason when the write is refused", async () => {
    const onConfirm = vi
      .fn<(reason: string) => Promise<void>>()
      .mockRejectedValue(
        new ApiRequestError("CONFLICT", "x", undefined, 409, { reason: "self_action" }),
      );
    const onOpenChange = setup(onConfirm);
    await userEvent.type(reasonField(), "Because I can");
    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(await screen.findByText(t("admin.reason.self_action"))).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("ConfirmDialog without a reason", () => {
  it("confirms with the verb button and also replays after reauth", async () => {
    const onConfirm = vi
      .fn<(reason: string) => Promise<void>>()
      .mockRejectedValueOnce(reauthRequired())
      .mockResolvedValueOnce(undefined);
    fetchMock.mockResolvedValue(json({ reauthAt: "2026-10-11T10:00:00.000Z" }));
    setup(onConfirm, false);
    expect(screen.queryByLabelText(new RegExp(`^${t("admin.reason.label")}`))).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await userEvent.type(
      await screen.findByLabelText(new RegExp(`^${t("auth.field.password")}`)),
      "my current password",
    );
    await userEvent.click(screen.getByRole("button", { name: t("auth.reauth.confirm") }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });
  });
});
