export const DEFAULT_COMPLETION_LIMIT = 20;

export const IGNORED_COMPLETION_NAMES = new Set([
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

export type FileCompletion = {
  readonly path: string;
  readonly isDirectory: boolean;
};

export type FileCompletionReport = ActiveFileMention & {
  readonly replacement: string;
  readonly matches: FileCompletion[];
};

export type FileCompletionSettings = {
  readonly limit?: number;
};
