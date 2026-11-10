import { listModelProfiles } from "@/domain/model-lookup.ts";
import { listCheckpoints } from "@/store/checkpoints.ts";
import { readSessionsDirectory } from "@/store/paths.ts";
import { listSessions } from "@/store/session-store.ts";
import type { LoadPromptSuggestionsSettings, PromptSuggestion } from "./types.ts";
import { readSuggestionLimit } from "./types.ts";

const BOTH_FLAG = "--both";

const FILES_FLAG = "--files";

const FLAG_KIND = "flag";

const LAST_FLAG = "--last";

export const listSessionSuggestions = async (
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> => {
  const hasNoSessionSettings = settings.sessionOptions == null;
  const sessionSettings = hasNoSessionSettings
    ? { baseDir: readSessionsDirectory(settings.repoRoot) }
    : settings.sessionOptions;
  const sessions = await listSessions(sessionSettings);
  const limit = readSuggestionLimit(settings.limit);

  return sessions.slice(0, limit).map((session) => {
    const isModelMissing = session.model == null;
    const modelLabel = isModelMissing ? "unknown" : session.model;

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
    const isLabelMissing = checkpoint.label == null;
    const labelSuffix = isLabelMissing ? "" : checkpoint.label;

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
    { value: LAST_FLAG, label: LAST_FLAG, kind: FLAG_KIND, detail: "latest local bridge session" },
    ...(await listSessionSuggestions(settings)),
  ];
};

export const listRewindFlagSuggestions = (): PromptSuggestion[] => {
  return [
    { value: FILES_FLAG, label: FILES_FLAG, kind: FLAG_KIND, detail: "restore files only" },
    {
      value: BOTH_FLAG,
      label: BOTH_FLAG,
      kind: FLAG_KIND,
      detail: "restore files and retry prompt",
    },
  ];
};
