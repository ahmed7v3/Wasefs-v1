import { ERROR_INFO, type ErrorCode, type ErrorLocale } from "./codes.js";

/** Plain JSON values only: `details` is returned to clients, so it must never hold secrets. */
export type SafeDetails = Record<string, string | number | boolean | null | string[] | number[]>;

export interface AppErrorOptions {
  httpStatus?: number;
  /** Safe to send to the client (field paths, limits). Never put raw input values here. */
  details?: SafeDetails;
  /** Internal cause for logs / `error_events`; never serialized to clients. */
  cause?: unknown;
}

export interface AppErrorResponse {
  code: ErrorCode;
  message: string;
  details?: SafeDetails;
  ref?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: SafeDetails | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(ERROR_INFO[code].message.en, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? ERROR_INFO[code].httpStatus;
    this.details = options.details;
  }

  /** Client-safe body: no stack, no cause. */
  toResponse(locale: ErrorLocale = "ar", ref?: string): AppErrorResponse {
    return {
      code: this.code,
      message: ERROR_INFO[this.code].message[locale],
      ...(this.details ? { details: this.details } : {}),
      ...(ref ? { ref } : {}),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
