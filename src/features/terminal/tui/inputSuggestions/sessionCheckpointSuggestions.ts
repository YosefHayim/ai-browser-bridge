import { listModelProfiles } from "@/features/domain";
import { listCheckpoints } from "@/features/store";
import { sessionsDir } from "@/features/store";
import { listSessions } from "@/features/store";
import type { InputSuggestion, LoadInputSuggestionsOptions } from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/**
 * List recent local bridge sessions as suggestions.
 *
 * @param options - Options that configure the operation.
 * @returns The `sessionSuggestions` result.
 * @example
 * ```ts
 * const result = await sessionSuggestions(options);
 * ```
 */
export const sessionSuggestions = async (
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> => {
  const sessions = await listSessions(
    options.sessionOptions ?? { baseDir: sessionsDir(options.repoRoot) },
  );
  return sessions.slice(0, options.limit ?? DEFAULT_SUGGESTION_LIMIT).map((session) => ({
    value: session.id,
    label: session.id,
    kind: "session" as const,
    detail: `${session.updatedAt} ${session.model ?? "unknown"}`,
  }));
};

/**
 * List recent file checkpoints as suggestions.
 *
 * @param options - Options that configure the operation.
 * @returns The `checkpointSuggestions` result.
 * @example
 * ```ts
 * const result = await checkpointSuggestions(options);
 * ```
 */
export const checkpointSuggestions = async (
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> => {
  const checkpoints = await listCheckpoints({
    repoRoot: options.repoRoot,
    checkpointRoot: options.checkpointRoot,
  });
  return checkpoints.slice(0, options.limit ?? DEFAULT_SUGGESTION_LIMIT).map((checkpoint) => ({
    value: checkpoint.id,
    label: checkpoint.id,
    kind: "checkpoint" as const,
    detail: `${checkpoint.phase} ${checkpoint.fileCount} files ${checkpoint.label ?? ""}`.trim(),
  }));
};

/**
 * List known model profiles as suggestions.
 *
 * @param options - Options that configure the operation.
 * @returns The `modelSuggestions` result.
 * @example
 * ```ts
 * const result = modelSuggestions(options);
 * ```
 */
export const modelSuggestions = (options: LoadInputSuggestionsOptions): InputSuggestion[] => {
  return listModelProfiles().map((profile) => ({
    value: profile.label,
    label: profile.label,
    kind: "model" as const,
    detail: `${profile.contextWindow.toLocaleString()} ctx`,
  }));
};

/**
 * Resume/open command flag and session suggestions.
 *
 * @param options - Options that configure the operation.
 * @returns The `resumeSessionSuggestions` result.
 * @example
 * ```ts
 * const result = await resumeSessionSuggestions(options);
 * ```
 */
export const resumeSessionSuggestions = async (
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> => {
  return [
    { value: "--last", label: "--last", kind: "flag", detail: "latest local bridge session" },
    ...(await sessionSuggestions(options)),
  ];
};

/**
 * Rewind flag suggestions for --files and --both.
 *
 * @returns The `rewindFlagSuggestions` result.
 * @example
 * ```ts
 * const result = rewindFlagSuggestions();
 * ```
 */
export const rewindFlagSuggestions = (): InputSuggestion[] => {
  return [
    { value: "--files", label: "--files", kind: "flag", detail: "restore files only" },
    { value: "--both", label: "--both", kind: "flag", detail: "restore files and retry prompt" },
  ];
};
