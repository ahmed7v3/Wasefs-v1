/*
 * The capture contract (Task 2.6). The UI package knows nothing about the API, R2, pdf.js or HEIC:
 * `apps/web` injects an uploader (prepare + upload) and, optionally, a handoff client.
 */

export type QualityIssue = "low_res" | "blurry" | "dark" | "bright";

export type CapturePageStatus = "processing" | "uploading" | "uploaded" | "error" | "warning";

export interface CapturePage {
  /** Stable id inside the browser; the server's `fileId` exists only after the upload. */
  localId: string;
  fileId: string | null;
  status: CapturePageStatus;
  /** Object URL (or a short-lived image link for pages that came from a phone). Empty while processing. */
  previewUrl: string;
  quality: { issues: QualityIssue[] };
  /** Support reference (`WSF-XXXX-XXXX`) of the failure, when the API gave one. */
  errorRef?: string | undefined;
  /** Friendly sentence for `status: "error"`. */
  errorMessage?: string | undefined;
  /** Upload progress, 0 to 1, while `status` is `uploading`. */
  progress?: number | undefined;
}

/** A page ready to upload: always a JPEG of at most 2048 px on the long edge. */
export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  /** Lower-case hex SHA-256 of `blob`. */
  sha256: string;
  issues: QualityIssue[];
}

/** A failure with a sentence the user can read and, optionally, a support reference. */
export class CaptureError extends Error {
  readonly ref: string | undefined;

  constructor(message: string, ref?: string) {
    super(message);
    this.name = "CaptureError";
    this.ref = ref;
  }
}

export interface CaptureUploader {
  /**
   * Turns a picked file into ready pages: HEIC converted, a PDF split into pages, resized, JPEG
   * encoded and quality-checked, all in the browser. `trimmed` is true when a PDF had more pages
   * than `maxPages`. Throws `CaptureError` with a readable message.
   */
  prepare(
    file: File,
    options: { signal: AbortSignal; maxPages: number },
  ): Promise<{ pages: PreparedImage[]; trimmed: boolean }>;
  /** Uploads one page and resolves with the server's file id once it is processed. */
  upload(
    image: PreparedImage,
    options: { signal: AbortSignal; onProgress: (fraction: number) => void },
  ): Promise<{ fileId: string }>;
}

export interface HandoffSession {
  url: string;
  /** ISO time the link stops working. */
  expiresAt: string;
}

export interface HandoffClient {
  start(captureSessionId: string): Promise<HandoffSession>;
  /** Live feed of phone pages. Returns the function that closes it. */
  subscribe(captureSessionId: string, onFile: (fileId: string) => void): () => void;
  /** The link as a QR image source (a data URL); `undefined` when it cannot be drawn. */
  qr(url: string): Promise<string | undefined>;
  /** Waits until a phone page is processed and returns something an `<img>` can show. */
  adopt(fileId: string, signal: AbortSignal): Promise<{ previewUrl: string }>;
}
