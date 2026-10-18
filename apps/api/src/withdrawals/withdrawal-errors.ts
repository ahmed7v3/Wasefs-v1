import { WithdrawalError } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

/** Turns a `WithdrawalError` into the API's error shape; anything else passes through unchanged. */
export function mapWithdrawalError(error: unknown): unknown {
  if (!(error instanceof WithdrawalError)) return error;
  switch (error.reason) {
    // A foreign request or destination looks exactly like a missing one.
    case "not_found":
      return new AppError(ErrorCode.NOT_FOUND, { cause: error });
    case "own_request":
    case "same_reviewer":
      return new AppError(ErrorCode.FORBIDDEN, { cause: error, details: { reason: error.reason } });
    case "invalid_destination":
      return new AppError(ErrorCode.VALIDATION_FAILED, { cause: error });
    default:
      return new AppError(ErrorCode.CONFLICT, { cause: error, details: { reason: error.reason } });
  }
}
