import { CheckpointStore } from "@/checkpoints/checkpoint-store.ts";
import { listModelProfiles } from "@/model-profiles/model-lookup.ts";
import { readSessionsDirectory } from "@/repo-files/paths.ts";
import { SessionStore } from "@/sessions/session-store.ts";
import type {
  LoadPromptSuggestionsSettings,
  PromptSuggestion,
} from "@/terminal/tui/suggestions/types.ts";
import { readSuggestionLimit } from "@/terminal/tui/suggestions/types.ts";

export const BOTH_FLAG = "--both";

export const FILES_FLAG = "--files";

const FLAG_KIND = "flag";

const LAST_FLAG = "--last";

export async function listSessionSuggestions(
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> {
  const sessionStore =
    settings.sessionStore ?? new SessionStore(readSessionsDirectory(settings.repoRoot));
  const sessions = await sessionStore.list();
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
}

export async function listCheckpointSuggestions(
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> {
  const checkpoints = await new CheckpointStore(settings.repoRoot, settings.checkpointRoot).list();
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
}

export function listModelSuggestions(): PromptSuggestion[] {
  return listModelProfiles().map((profile) => ({
    value: profile.label,
    label: profile.label,
    kind: "model" as const,
    detail: `${profile.contextWindow.toLocaleString()} ctx`,
  }));
}

export async function resumeSessionSuggestions(
  settings: LoadPromptSuggestionsSettings,
): Promise<PromptSuggestion[]> {
  const sessionSuggestions = await listSessionSuggestions(settings);
  return [
    { value: LAST_FLAG, label: LAST_FLAG, kind: FLAG_KIND, detail: "latest local bridge session" },
    ...sessionSuggestions,
  ];
}

export function listRewindFlagSuggestions(): PromptSuggestion[] {
  return [
    { value: FILES_FLAG, label: FILES_FLAG, kind: FLAG_KIND, detail: "restore files only" },
    {
      value: BOTH_FLAG,
      label: BOTH_FLAG,
      kind: FLAG_KIND,
      detail: "restore files and retry prompt",
    },
  ];
}
