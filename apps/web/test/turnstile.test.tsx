// @vitest-environment jsdom
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  document.head.innerHTML = "";
  delete window.turnstile;
});

async function load() {
  vi.resetModules();
  return import("../src/components/turnstile");
}

describe("without a site key", () => {
  it("renders nothing, loads nothing and sends no token", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const { Turnstile, useTurnstile } = await load();
    const { container } = render(<Turnstile onToken={() => undefined} nonce="n" />);
    expect(container.innerHTML).toBe("");
    expect(document.head.querySelector("script")).toBeNull();

    const { result } = renderHook(() => useTurnstile());
    expect(result.current.enabled).toBe(false);
    expect(result.current.requireToken()).toBeUndefined();
  });
});

describe("with a site key", () => {
  it("refuses to submit before the check is solved, with the turnstile_required reason", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    const { useTurnstile } = await load();
    const { result } = renderHook(() => useTurnstile());
    expect(result.current.enabled).toBe(true);
    let thrown: unknown;
    try {
      result.current.requireToken();
    } catch (error) {
      thrown = error;
    }
    // Same module instance as the component (the registry was reset by `load`).
    const { errorReason } = await import("../src/lib/api-error");
    expect(errorReason(thrown)).toBe("turnstile_required");

    act(() => {
      result.current.widgetProps.onToken("token-1");
    });
    expect(result.current.requireToken()).toBe("token-1");
    act(() => {
      result.current.reset();
    });
    expect(result.current.token).toBeNull();
  });

  it("loads the script with the CSP nonce, renders explicitly in Arabic and reports tokens", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    const { Turnstile } = await load();
    const onToken = vi.fn();
    const render_ = vi.fn<NonNullable<Window["turnstile"]>["render"]>(() => "widget-1");
    const remove = vi.fn();

    const view = render(<Turnstile onToken={onToken} nonce="abc123" />);
    const script = document.head.querySelector("script");
    expect(script?.getAttribute("src")).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    );
    expect(script?.nonce).toBe("abc123");

    window.turnstile = { render: render_, reset: vi.fn(), remove };
    act(() => {
      script?.dispatchEvent(new Event("load"));
    });
    await waitFor(() => {
      expect(render_).toHaveBeenCalledTimes(1);
    });
    const options = render_.mock.calls[0]?.[1];
    expect(options).toMatchObject({ sitekey: "site-key", language: "ar" });
    options?.callback("solved");
    expect(onToken).toHaveBeenCalledWith("solved");
    options?.["expired-callback"]();
    expect(onToken).toHaveBeenLastCalledWith(null);

    view.unmount();
    expect(remove).toHaveBeenCalledWith("widget-1");
  });
});
