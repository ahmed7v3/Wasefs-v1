// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { signInEmailSchema } from "@wasfa/shared/schemas/auth";
import { describe, expect, it, vi } from "vitest";

import { ErrorNotice } from "../src/components/error-notice";
import { ErrorSummary } from "../src/components/forms/error-summary";
import { ApiRequestError } from "../src/lib/api-error";
import { useApiForm } from "../src/lib/forms";

function Harness({
  submit,
}: {
  submit: (values: { email: string; password: string }) => Promise<void>;
}) {
  const form = useApiForm({
    schema: signInEmailSchema,
    initial: { email: "", password: "" },
    submit,
  });
  return (
    <form onSubmit={form.handleSubmit} noValidate>
      <input
        aria-label="email"
        {...form.bind("email")}
        aria-invalid={form.errors["email"] ? true : undefined}
      />
      <input aria-label="password" {...form.bind("password")} />
      <output data-testid="errors">{JSON.stringify(form.errors)}</output>
      <output data-testid="form-error">{form.formError?.code ?? ""}</output>
      <button type="submit" disabled={form.submitting}>
        go
      </button>
    </form>
  );
}

describe("useApiForm", () => {
  it("blocks an invalid submit, shows required messages and focuses the first bad field", async () => {
    const submit = vi.fn(() => Promise.resolve());
    render(<Harness submit={submit} />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(submit).not.toHaveBeenCalled();
    expect(JSON.parse(screen.getByTestId("errors").textContent ?? "{}")).toEqual({
      email: t("form.required"),
      password: t("form.required"),
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("email"));
    });
  });

  it("submits parsed values (email trimmed and lower-cased) once", async () => {
    const submit = vi.fn(() => Promise.resolve());
    render(<Harness submit={submit} />);
    await userEvent.type(screen.getByLabelText("email"), "  Sara@Example.com ");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(submit).toHaveBeenCalledWith({ email: "sara@example.com", password: "secret" });
  });

  it("maps server field paths onto the inputs and keeps what the user typed", async () => {
    const submit = vi.fn(() =>
      Promise.reject(
        new ApiRequestError("VALIDATION_FAILED", "x", undefined, 400, { fields: ["email"] }),
      ),
    );
    render(<Harness submit={submit} />);
    await userEvent.type(screen.getByLabelText("email"), "sara@example.com");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId("errors").textContent ?? "{}")).toEqual({
        email: t("form.invalid"),
      });
    });
    expect((screen.getByLabelText("email") as HTMLInputElement).value).toBe("sara@example.com");
    expect(screen.getByTestId("form-error").textContent).toBe("");
  });

  it("keeps other API errors as a form-level error", async () => {
    const submit = vi.fn(() =>
      Promise.reject(new ApiRequestError("RATE_LIMITED", "x", undefined, 429)),
    );
    render(<Harness submit={submit} />);
    await userEvent.type(screen.getByLabelText("email"), "sara@example.com");
    await userEvent.type(screen.getByLabelText("password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(screen.getByTestId("form-error").textContent).toBe("RATE_LIMITED");
    });
  });

  it("clears a field's error as soon as it becomes valid", async () => {
    render(<Harness submit={() => Promise.resolve()} />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.type(screen.getByLabelText("email"), "sara@example.com");
    expect(JSON.parse(screen.getByTestId("errors").textContent ?? "{}")).toEqual({
      password: t("form.required"),
    });
  });
});

describe("ErrorSummary", () => {
  const labels = { a: "A", b: "B", c: "C", d: "D" };

  it("stays hidden up to three errors and takes focus beyond", () => {
    const { rerender } = render(
      <ErrorSummary errors={{ a: "x", b: "y", c: "z" }} labels={labels} focusKey={1} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      <form>
        <input name="a" aria-label="a-field" />
        <ErrorSummary errors={{ a: "x", b: "y", c: "z", d: "w" }} labels={labels} focusKey={2} />
      </form>,
    );
    const alert = screen.getByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("moves focus to the field when its entry is pressed", async () => {
    render(
      <form>
        <input name="a" aria-label="a-field" />
        <ErrorSummary errors={{ a: "x", b: "y", c: "z", d: "w" }} labels={labels} focusKey={1} />
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: /A: x/ }));
    expect(document.activeElement).toBe(screen.getByLabelText("a-field"));
  });
});

describe("ErrorNotice", () => {
  it("shows the code's friendly message and the WSF reference", () => {
    render(<ErrorNotice error={new ApiRequestError("INTERNAL", "x", "WSF-7K2M-9QXD", 500)} />);
    expect(screen.getByRole("alert").textContent).toContain(t("error.INTERNAL"));
    expect(screen.getByText(t("common.errorRef", { ref: "WSF-7K2M-9QXD" }))).toBeTruthy();
  });

  it("asks to wait on RATE_LIMITED and prefers a specific reason", () => {
    const { rerender } = render(
      <ErrorNotice error={new ApiRequestError("RATE_LIMITED", "x", undefined, 429)} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(t("error.RATE_LIMITED"));
    rerender(
      <ErrorNotice
        error={
          new ApiRequestError("AUTH_REQUIRED", "x", undefined, 401, {
            reason: "invalid_credentials",
          })
        }
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(t("auth.error.invalidCredentials"));
  });

  it("offers retry and support only when given", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorNotice error={new Error("x")} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(
      <ErrorNotice
        error={new Error("x")}
        onRetry={onRetry}
        supportHref="mailto:help@example.com"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: t("common.contactSupport") })).toBeTruthy();
  });
});
