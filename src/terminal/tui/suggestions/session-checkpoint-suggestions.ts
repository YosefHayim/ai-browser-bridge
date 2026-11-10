import { listModelProfiles } from "@/domain/model-lookup.ts";
import { listCheckpoints } from "@/store/checkpoints.ts";
import { readSessionsDirectory } from "@/store/paths.ts";
import { listSessions } from "@/store/session-store.ts";
import type { LoadPromptSuggestionsSettings, PromptSuggestion } from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

export const listSessionSuggestions = async (
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> => {
  const sessionSettings =
    settings.sessionOptions == null
      ? { baseDir: readSessionsDirectory(settings.repoRoot) }
      : settings.sessionOptions;
  const sessions = await listSessions(sessionSettings);
  const limit = readSuggestionLimit(settings.limit);
  return sessions.slice(0, limit).map((session) => {
    const modelLabel = session.model == null ? "unknown" : session.model;
    return {
      value: session.id,
      label: session.id,
      kind: "session" as const,
      detail: `${session.updatedAt} ${modelLabel}`,
    };
  });
};

export const listCheckpointSuggestions = async (
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> => {
  const checkpoints = await listCheckpoints({
    repoRoot: settings.repoRoot,
    checkpointRoot: settings.checkpointRoot,
  });
  const limit = readSuggestionLimit(settings.limit);
  return checkpoints.slice(0, limit).map((checkpoint) => {
    const labelSuffix = checkpoint.label == null ? "" : checkpoint.label;
    return {
      value: checkpoint.id,
      label: checkpoint.id,
      kind: "checkpoint" as const,
      detail: `${checkpoint.phase} ${checkpoint.fileCount} files ${labelSuffix}`.trim(),
    };
  });
};

export const listModelSuggestions = (): PromptSuggestion[] => {
  return listModelProfiles().map((profile) => ({
    value: profile.label,
    label: profile.label,
    kind: "model" as const,
    detail: `${profile.contextWindow.toLocaleString()} ctx`,
  }));
};

export const resumeSessionSuggestions = async (
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> => {
  return [
    { value: "--last", label: "--last", kind: "flag", detail: "latest local bridge session" },
    ...(await listSessionSuggestions(settings)),
  ];
};

export const listRewindFlagSuggestions = (): PromptSuggestion[] => {
  return [
    { value: "--files", label: "--files", kind: "flag", detail: "restore files only" },
    { value: "--both", label: "--both", kind: "flag", detail: "restore files and retry prompt" },
  ];
};
