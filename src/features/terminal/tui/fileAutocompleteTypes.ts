/** Active `@file` mention span inside composer input text. */
export interface ActiveFileMention {
  /** Start index of the `@` character. */
  start: number;
  /** End index of the active mention span. */
  end: number;
  /** Partial path typed after `@`. */
  partial: string;
}

/** One filesystem entry offered as a completion candidate. */
export interface FileCompletionMatch {
  /** Repo-relative path with trailing slash for directories. */
  path: string;
  /** Whether the entry is a directory. */
  isDirectory: boolean;
}

/** Result of completing an active `@file` mention. */
export interface FileCompletionResult extends ActiveFileMention {
  /** Normalized partial path used for matching. */
  partial: string;
  /** Best-match replacement path. */
  replacement: string;
  /** All completion candidates within the limit. */
  matches: FileCompletionMatch[];
}

/** Options controlling file mention completion behavior. */
export interface FileCompletionOptions {
  /** Maximum number of matches to return. */
  limit?: number;
}

/** Default maximum number of completion matches. */
export const DEFAULT_COMPLETION_LIMIT = 20;

/** Directory names excluded from file mention completion. */
export const IGNORED_COMPLETION_ENTRIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);
