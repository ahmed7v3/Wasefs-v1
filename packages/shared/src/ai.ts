/*
 * Closed value sets for the AI product (Phase 2, Task 2.1): tasks, modes, providers, credits,
 * uploads, chats, drugs and evals. Same rule as `identity.ts`: one tuple types the column, builds
 * the DB CHECK and drives the zod schemas and admin forms, so they cannot drift.
 */
import { LOCALES } from "./i18n/index.js";

/** What a model call is for. Routes, entitlements and usage rows are all keyed by task. */
export const AI_TASKS = [
  "rx_extract",
  "rx_verify",
  "chat",
  "deep_think",
  "title_gen",
  "classify",
  "summarize",
  "web_search",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Prescription and health-chat tasks: a provider that may train on the data must never see them. */
export const MEDICAL_AI_TASKS: ReadonlySet<AiTask> = new Set([
  "rx_extract",
  "rx_verify",
  "chat",
  "deep_think",
]);

/** What users choose (never a model name): "سريع", "متوازن", "عميق". */
export const AI_MODES = ["fast", "balanced", "deep"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const AI_PROVIDER_KINDS = ["gemini", "openrouter", "openai_compatible", "fake"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** What the provider may do with our data; medical tasks refuse `free_tier`. */
export const AI_DATA_POLICIES = ["paid_no_training", "zdr", "free_tier"] as const;
export type AiDataPolicy = (typeof AI_DATA_POLICIES)[number];

export const AI_CAPABILITIES = ["vision", "thinking", "search", "json", "bbox"] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const AI_OUTCOMES = ["ok", "error", "timeout", "cancelled", "refused", "cache_hit"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** Where a model price came from. */
export const PRICE_SOURCES = ["manual", "openrouter_sync"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const CREDIT_LEDGER_KINDS = [
  "grant",
  "admin_adjust",
  "usage_reserve",
  "usage_settle",
  "release",
  "refund",
  "expiry",
  // Phase 3: a paid credit pack, points converted to credits, a trial and a reward bonus.
  "purchase",
  "points_conversion",
  "trial_grant",
  "reward_bonus",
] as const;
export type CreditLedgerKind = (typeof CREDIT_LEDGER_KINDS)[number];

export const CREDIT_RESERVATION_STATUSES = ["open", "settled", "released", "expired"] as const;
export type CreditReservationStatus = (typeof CREDIT_RESERVATION_STATUSES)[number];

export const FILE_PURPOSES = ["rx_page", "chat_image"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const FILE_STATUSES = ["pending", "uploaded", "processed", "rejected", "deleted"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/** Image types accepted for upload. Contain `/`, so the DB CHECK uses `FILE_MIME_PATTERN`, not `inList()`. */
export const FILE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type FileMime = (typeof FILE_MIMES)[number];

/** Built from `FILE_MIMES` (no backslashes, so the DB can inline `.source`), so the two cannot drift. */
export const FILE_MIME_PATTERN = new RegExp(
  `^image[/](${FILE_MIMES.map((mime) => mime.slice("image/".length)).join("|")})$`,
);

/** One byte to 15 MB; the presigned PUT is signed for the exact length. */
export const FILE_MIN_BYTES = 1;
export const FILE_MAX_BYTES = 15 * 1024 * 1024;

/** SHA-256 of the processed image, lower-case hex. */
export const FILE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
/** 64-bit perceptual hash (dHash), lower-case hex. */
export const FILE_DHASH_PATTERN = /^[a-f0-9]{16}$/;

export const CHAT_ROLES = ["user", "assistant", "system"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const CHAT_MESSAGE_STATUSES = ["streaming", "done", "stopped", "error"] as const;
export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];

export const DRUG_SOURCES = ["eda", "sfda", "manual", "other"] as const;
export type DrugSource = (typeof DRUG_SOURCES)[number];

export const DRUG_IMPORT_STATUSES = [
  "draft",
  "dry_run",
  "committed",
  "rolled_back",
  "failed",
] as const;
export type DrugImportStatus = (typeof DRUG_IMPORT_STATUSES)[number];

export const DRUG_STATUSES = ["active", "withdrawn"] as const;
export type DrugStatus = (typeof DRUG_STATUSES)[number];

/** Language of a drug alias. */
export const DRUG_ALIAS_LANGS = LOCALES;

export const EVAL_RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number];
