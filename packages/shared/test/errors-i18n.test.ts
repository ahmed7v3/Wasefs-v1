import { describe, expect, it } from "vitest";

import { AppError, ERROR_CODES, ERROR_INFO, ErrorCode } from "../src/errors/index.js";
import { t } from "../src/i18n/index.js";

describe("error codes", () => {
  it("has Arabic and English text and an HTTP status for every code", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_INFO[code].message.ar.length).toBeGreaterThan(0);
      expect(ERROR_INFO[code].message.en.length).toBeGreaterThan(0);
      expect(ERROR_INFO[code].httpStatus).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("AppError", () => {
  it("maps to a client-safe response without stack or cause", () => {
    const err = new AppError(ErrorCode.NOT_FOUND, {
      details: { resource: "prescription" },
      cause: new Error("SELECT * FROM secrets"),
    });
    expect(err.httpStatus).toBe(404);
    const body = err.toResponse("ar", "WSF-AAAA-BBBB");
    expect(body).toEqual({
      code: "NOT_FOUND",
      message: ERROR_INFO.NOT_FOUND.message.ar,
      details: { resource: "prescription" },
      ref: "WSF-AAAA-BBBB",
    });
    expect(JSON.stringify(body)).not.toContain("SELECT");
  });

  it("allows overriding the status", () => {
    expect(new AppError(ErrorCode.VALIDATION_FAILED, { httpStatus: 422 }).httpStatus).toBe(422);
  });
});

describe("t()", () => {
  it("defaults to Arabic and interpolates params", () => {
    expect(t("brand.name")).toBe("وصفة AI");
    expect(t("common.errorRef", { ref: "WSF-AAAA-BBBB" })).toContain("WSF-AAAA-BBBB");
  });

  it("leaves placeholders without a matching param untouched", () => {
    expect(t("common.errorRef", { other: "x" })).toContain("{ref}");
  });

  it("serves English and falls back to Arabic when untranslated", () => {
    expect(t("common.retry", undefined, "en")).toBe("Try again");
    expect(t("notFound.title", undefined, "en")).toBe(t("notFound.title"));
  });

  it("resolves error messages from the shared codes", () => {
    expect(t("error.INTERNAL")).toBe(ERROR_INFO.INTERNAL.message.ar);
  });
});
