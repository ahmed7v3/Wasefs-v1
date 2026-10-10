// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../src/lib/api-error";
import { ReauthProvider, isReauthRequired, useReauth } from "../src/lib/reauth";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reauthRequired = () =>
  new ApiRequestError("AUTH_REQUIRED", "x", undefined, 401, { reason: "reauth" });

function Trigger({ action }: { action: () => Promise<string> }) {
  const reauth = useReauth();
  const [outcome, setOutcome] = useState("idle");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          reauth.run(action).then(
            (value) => {
              setOutcome(`ok:${value}`);
            },
            (error: unknown) => {
              setOutcome(`error:${error instanceof ApiRequestError ? error.code : "other"}`);
            },
          );
        }}
      >
        run
      </button>
      <output data-testid="outcome">{outcome}</output>
    </>
  );
}

function setup(action: () => Promise<string>) {
  render(
    <ReauthProvider>
      <Trigger action={action} />
    </ReauthProvider>,
  );
}

describe("isReauthRequired", () => {
  it("recognises only AUTH_REQUIRED with reason reauth", () => {
    expect(isReauthRequired(reauthRequired())).toBe(true);
    expect(isReauthRequired(new ApiRequestError("AUTH_REQUIRED", "x", undefined, 401))).toBe(false);
    expect(
      isReauthRequired(new ApiRequestError("FORBIDDEN", "x", undefined, 403, { reason: "reauth" })),
    ).toBe(false);
    expect(isReauthRequired(new Error("x"))).toBe(false);
  });
});

describe("ReauthProvider", () => {
  it("asks for the password, confirms it, and replays the action once", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(reauthRequired())
      .mockResolvedValueOnce("done");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ reauthAt: "2026-10-10T10:00:00.000Z" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    setup(action);
    await userEvent.click(screen.getByRole("button", { name: "run" }));

    const password = await screen.findByLabelText(new RegExp(`^${t("auth.field.password")}`));
    await userEvent.type(password, "my current password");
    await userEvent.click(screen.getByRole("button", { name: t("auth.reauth.confirm") }));

    await waitFor(() => {
      expect(screen.getByTestId("outcome").textContent).toBe("ok:done");
    });
    expect(action).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/auth\/reauth$/);
    expect(init?.body).toBe(JSON.stringify({ password: "my current password" }));
  });

  it("rethrows the original error when the user cancels", async () => {
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(reauthRequired());
    setup(action);
    await userEvent.click(screen.getByRole("button", { name: "run" }));
    await screen.findByLabelText(new RegExp(`^${t("auth.field.password")}`));
    await userEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => {
      expect(screen.getByTestId("outcome").textContent).toBe("error:AUTH_REQUIRED");
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not interfere with other errors", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new ApiRequestError("RATE_LIMITED", "x", undefined, 429));
    setup(action);
    await userEvent.click(screen.getByRole("button", { name: "run" }));
    await waitFor(() => {
      expect(screen.getByTestId("outcome").textContent).toBe("error:RATE_LIMITED");
    });
    expect(screen.queryByLabelText(new RegExp(`^${t("auth.field.password")}`))).toBeNull();
  });

  it("keeps the dialog open with the error when the password is wrong", async () => {
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(reauthRequired());
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "AUTH_REQUIRED",
          message: "x",
          details: { reason: "invalid_credentials" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    setup(action);
    await userEvent.click(screen.getByRole("button", { name: "run" }));
    await userEvent.type(
      await screen.findByLabelText(new RegExp(`^${t("auth.field.password")}`)),
      "wrong password",
    );
    await userEvent.click(screen.getByRole("button", { name: t("auth.reauth.confirm") }));
    expect(await screen.findByText(t("auth.error.invalidCredentials"))).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("outcome").textContent).toBe("idle");
  });
});
