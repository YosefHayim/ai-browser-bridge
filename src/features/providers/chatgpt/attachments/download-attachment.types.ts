/** Error raised when an attachment cannot be resolved or downloaded. */
export class AttachmentDownloadError extends Error {
  /** Attachment id that failed to download. */
  readonly id: string;
  /** Source URL when known. */
  readonly url: string | undefined;
  override readonly cause: unknown;

  constructor(id: string, url: string | undefined, message: string, cause?: unknown) {
    super(message);
    this.name = "AttachmentDownloadError";
    this.id = id;
    this.url = url;
    this.cause = cause;
  }
}

/** Result of downloading a single attachment. */
export interface DownloadResult {
  /** Absolute path to the saved file. */
  path: string;
  /** Number of bytes written or skipped. */
  bytes: number;
}

/** Per-item result when downloading multiple attachments. */
export interface DownloadAllResult extends DownloadResult {
  /** Attachment id from the manifest. */
  id: string;
  /** Error message when the download failed. */
  error?: string;
}

/** Options for downloading one attachment. */
export interface DownloadOptions {
  /** Optional output directory override. */
  outDir?: string;
}

/** Options for downloading many attachments. */
export interface DownloadAllOptions extends DownloadOptions {
  /** Optional subset of attachment ids to download. */
  ids?: string[];
}
