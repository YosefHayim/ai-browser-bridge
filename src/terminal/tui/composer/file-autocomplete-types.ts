export const DEFAULT_COMPLETION_LIMIT = 20;

export const IGNORED_COMPLETION_ENTRIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

export type ActiveFileMention = {
  readonly start: number;
  readonly end: number;
  readonly partial: string;
};

export type FileCompletionMatch = {
  readonly path: string;
  readonly isDirectory: boolean;
};

export type FileCompletionResult = ActiveFileMention & {
  readonly replacement: string;
  readonly matches: FileCompletionMatch[];
};

export type FileCompletionOptions = {
  readonly limit?: number;
};
