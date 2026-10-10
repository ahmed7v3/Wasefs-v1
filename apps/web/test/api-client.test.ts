import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { api } from "../src/lib/api-client";
import { ApiRequestError, errorReason, fieldPaths } from "../src/lib/api-error";

const API = "https://api.wasfa.online";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): { url: string; init: RequestInit & { headers: Record<string, string> } } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return {
    url: String(call[0]),
    init: call[1] as RequestInit & { headers: Record<string, string> },
  };
}

describe("api", () => {
  it("sends credentials and the default headers on a GET, without a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api("/me");
    const { url, init } = lastCall();
    expect(url).toBe(`${API}/me`);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ Accept: "application/json", "Accept-Language": "ar" });
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeUndefined();
  });

  it("sends a JSON body with its content type and the Turnstile token header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api("/auth/sign-up/email", {
      method: "POST",
      body: { email: "a@b.co" },
      turnstileToken: "tok-1",
    });
    const { init } = lastCall();
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ email: "a@b.co" }));
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-turnstile-token": "tok-1",
    });
  });

  it("omits the Turnstile header when there is no token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api("/x", { method: "POST", body: {}, turnstileToken: null });
    expect(lastCall().init.headers).not.toHaveProperty("x-turnstile-token");
  });

  it("returns undefined for 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api("/me/sessions/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("parses the body with the schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ url: "https://accounts.example/auth", extra: 1 }));
    const result = await api("/auth/sign-in/social", {
      method: "POST",
      body: {},
      schema: z.object({ url: z.string() }),
    });
    expect(result).toEqual({ url: "https://accounts.example/auth" });
  });

  it("turns a schema mismatch into INTERNAL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));
    const error = await api("/me", { schema: z.object({ id: z.string() }) }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "INTERNAL", status: 200 });
  });

  it("maps an API error with details and ref", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          code: "VALIDATION_FAILED",
          message: "بعض البيانات غير صحيحة",
          details: { fields: ["email", "password"], reason: "turnstile_required" },
          ref: "WSF-7K2M-9QXD",
        },
        400,
      ),
    );
    const error = await api("/auth/sign-in/email", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "بعض البيانات غير صحيحة",
      ref: "WSF-7K2M-9QXD",
      status: 400,
    });
    expect(fieldPaths(error)).toEqual(["email", "password"]);
    expect(errorReason(error)).toBe("turnstile_required");
  });

  it("treats an unknown error body as INTERNAL, keeping the status", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await api("/me").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "INTERNAL", status: 502 });
    expect(fieldPaths(error)).toEqual([]);

    fetchMock.mockResolvedValue(jsonResponse({ code: "NOT_A_CODE", message: "x" }, 400));
    expect(await api("/me").catch((e: unknown) => e)).toMatchObject({ code: "INTERNAL" });
  });

  it("maps a network failure to UPSTREAM_UNAVAILABLE", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await api("/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", status: 0 });
  });

  it("lets an aborted request through untouched", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValue(abort);
    await expect(api("/me")).rejects.toBe(abort);
  });
});
