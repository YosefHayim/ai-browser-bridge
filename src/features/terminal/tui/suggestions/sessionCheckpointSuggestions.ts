import { listModelProfiles } from "@/features/domain";
import { listCheckpoints, listSessions, sessionsDir } from "@/features/store";
import type { InputSuggestion, LoadInputSuggestionsOptions } from "./types.ts";
import { suggestionLimit } from "./types.ts";

export const sessionSuggestions = async (
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> => {
  const sessionOptions =
    options.sessionOptions === undefined
      ? { baseDir: sessionsDir(options.repoRoot) }
      : options.sessionOptions;
  const sessions = await listSessions(sessionOptions);
  const limit = suggestionLimit(options.limit);
  return sessions.slice(0, limit).map((session) => {
    const modelLabel = session.model === undefined ? "unknown" : session.model;
    return {
      value: session.id,
      label: session.id,
      kind: "session" as const,
      detail: `${session.updatedAt} ${modelLabel}`,
    };
  });
};

export const checkpointSuggestions = async (
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> => {
  const checkpoints = await listCheckpoints({
    repoRoot: options.repoRoot,
    checkpointRoot: options.checkpointRoot,
  });
  const limit = suggestionLimit(options.limit);
  return checkpoints.slice(0, limit).map((checkpoint) => {
    const labelSuffix = checkpoint.label === undefined ? "" : checkpoint.label;
    return {
      value: checkpoint.id,
      label: checkpoint.id,
      kind: "checkpoint" as const,
      detail: `${checkpoint.phase} ${checkpoint.fileCount} files ${labelSuffix}`.trim(),
    };
  });
};

export const modelSuggestions = (): InputSuggestion[] => {
  return listModelProfiles().map((profile) => ({
    value: profile.label,
    label: profile.label,
    kind: "model" as const,
    detail: `${profile.contextWindow.toLocaleString()} ctx`,
  }));
};

export const resumeSessionSuggestions = async (
  options: LoadInputSuggestionsOptions,
): Promise<InputSuggestion[]> => {
  return [
    { value: "--last", label: "--last", kind: "flag", detail: "latest local bridge session" },
    ...(await sessionSuggestions(options)),
  ];
};

export const rewindFlagSuggestions = (): InputSuggestion[] => {
  return [
    { value: "--files", label: "--files", kind: "flag", detail: "restore files only" },
    { value: "--both", label: "--both", kind: "flag", detail: "restore files and retry prompt" },
  ];
};
