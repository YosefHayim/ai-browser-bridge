import { listModelProfiles } from "../../../domain/modelsConfig.ts";
import { listCheckpoints } from "../../../store/checkpoints.ts";
import { sessionsDir } from "../../../store/paths.ts";
import { listSessions } from "../../../store/sessionStore.ts";
import type { InputSuggestion, LoadInputSuggestionsOptions } from "./types.ts";
import { DEFAULT_SUGGESTION_LIMIT } from "./types.ts";

/** List recent local bridge sessions as suggestions. */
export async function sessionSuggestions(
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> {
  const sessions = await listSessions(
    options.sessionOptions ?? { baseDir: sessionsDir(options.repoRoot) },
  );
  return sessions.slice(0, options.limit ?? DEFAULT_SUGGESTION_LIMIT).map((session) => ({
    value: session.id,
    label: session.id,
    kind: "session" as const,
    detail: `${session.updatedAt} ${session.model ?? "unknown"}`,
  }));
}

/** List recent file checkpoints as suggestions. */
export async function checkpointSuggestions(
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> {
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
}

/** List known model profiles as suggestions. */
export function modelSuggestions(options: LoadInputSuggestionsOptions): InputSuggestion[] {
  return listModelProfiles().map((profile) => ({
    value: profile.label,
    label: profile.label,
    kind: "model" as const,
    detail: `${profile.contextWindow.toLocaleString()} ctx`,
  }));
}

/** Resume/open command flag and session suggestions. */
export async function resumeSessionSuggestions(
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> {
  return [
    { value: "--last", label: "--last", kind: "flag", detail: "latest local bridge session" },
    ...(await sessionSuggestions(options)),
  ];
}

/** Rewind flag suggestions for --files and --both. */
export function rewindFlagSuggestions(): InputSuggestion[] {
  return [
    { value: "--files", label: "--files", kind: "flag", detail: "restore files only" },
    { value: "--both", label: "--both", kind: "flag", detail: "restore files and retry prompt" },
  ];
}
