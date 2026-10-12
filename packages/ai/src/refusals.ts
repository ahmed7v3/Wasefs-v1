import { AppError, ErrorCode } from "@wasfa/shared/errors";

/**
 * AI work is refused (global kill switch, per-feature switch, or the daily spend cap). The web app
 * shows the friendly text keyed by `details.reason`: "الخدمة مزدحمة الآن، حاول بعد قليل".
 */
export const aiPausedError = (): AppError =>
  new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason: "ai_paused" } });

/** No usable model for the request (no route, every model disabled, lacking a capability, or unconfigured). */
export const noModelError = (reason: "no_route" | "no_model"): AppError =>
  new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason } });
