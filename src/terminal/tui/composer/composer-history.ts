const CONTROL_R_KEY = "\u0012";

const defaultHistoryLimit = 100;

interface PromptHistorySettings {
  readonly limit?: number;
}

export interface PromptHistory {
  readonly limit: number;
  readonly prompts: readonly string[];
  readonly browseIndex: number | null;
  readonly draft: string;
}

export interface PromptHistoryStep {
  readonly history: PromptHistory;
  readonly prompt: string;
}

export const createPromptHistory = (
  initialLines: readonly string[] = [],
  settings: PromptHistorySettings = {},
): PromptHistory => {
  const emptyHistory: PromptHistory = {
    limit: settings.limit ?? defaultHistoryLimit,
    prompts: [],
    browseIndex: null,
    draft: "",
  };

  return initialLines.reduce(addPrompt, emptyHistory);
};

export const addPrompt = (history: PromptHistory, prompt: string): PromptHistory => {
  const trimmed = prompt.trim();

  const isPromptNotStorable = !canStorePrompt(history, trimmed);
  if (isPromptNotStorable) return history;

  const promptsIncludingNew = [...history.prompts, trimmed];
  const overflowCount = Math.max(0, promptsIncludingNew.length - history.limit);
  const prompts = promptsIncludingNew.slice(overflowCount);

  return { ...history, prompts, browseIndex: null, draft: "" };
};

const canStorePrompt = (history: PromptHistory, trimmed: string): boolean => {
  const isTrimmedEmpty = trimmed === "";
  if (isTrimmedEmpty) return false;

  return history.prompts.at(-1) !== trimmed;
};

export const listPrompts = (history: PromptHistory): string[] => [...history.prompts];

export const stepToPreviousPrompt = (
  history: PromptHistory,
  currentDraft: string,
): PromptHistoryStep => {
  const isPromptsEmpty = history.prompts.length === 0;
  if (isPromptsEmpty) return { history, prompt: currentDraft };

  const { browseIndex } = history;
  const isNotBrowsingYet = browseIndex == null;
  const newestIndex = history.prompts.length - 1;
  const previousBrowseIndex = isNotBrowsingYet ? newestIndex : Math.max(0, browseIndex - 1);
  const nextDraft = isNotBrowsingYet ? currentDraft : history.draft;
  const nextHistory: PromptHistory = {
    ...history,
    browseIndex: previousBrowseIndex,
    draft: nextDraft,
  };

  const previousPrompt = history.prompts[previousBrowseIndex];
  const isPromptMissing = previousPrompt == null;
  if (isPromptMissing) return { history: nextHistory, prompt: currentDraft };

  return { history: nextHistory, prompt: previousPrompt };
};

export const stepToNextPrompt = (history: PromptHistory): PromptHistoryStep => {
  const { browseIndex } = history;
  const isNotBrowsing = browseIndex == null;
  if (isNotBrowsing) return { history, prompt: "" };

  const isBrowsePastEnd = browseIndex >= history.prompts.length;
  if (isBrowsePastEnd) return { history, prompt: history.draft };

  const nextBrowseIndex = browseIndex + 1;
  const nextHistory: PromptHistory = { ...history, browseIndex: nextBrowseIndex };

  const nextPrompt = history.prompts[nextBrowseIndex];
  const isNextPromptMissing = nextPrompt == null;
  if (isNextPromptMissing) return { history: nextHistory, prompt: history.draft };

  return { history: nextHistory, prompt: nextPrompt };
};

export const reverseSearchQuery = (query: string): string | null => {
  const markerIndex = query.lastIndexOf(CONTROL_R_KEY);

  const isMarkerNotFound = markerIndex === -1;
  if (isMarkerNotFound) return null;

  return query.slice(markerIndex + CONTROL_R_KEY.length);
};

export const reverseHistorySearch = (lines: readonly string[], query: string): string | null => {
  const normalizedQuery = query.toLowerCase();

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];

    const isLineMissing = line == null;
    if (isLineMissing) continue;

    const isLineMatchingQuery =
      normalizedQuery === "" || line.toLowerCase().includes(normalizedQuery);
    if (isLineMatchingQuery) return line;
  }

  return null;
};
