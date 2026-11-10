const CTRL_R = "\u0012";

const defaultHistoryLimit = 100;

interface PromptHistorySettings {
  readonly limit?: number;
}

export interface PromptHistory {
  readonly limit: number;
  readonly prompts: string[];
  browseIndex: number | null;
  draft: string;
}

export const createPromptHistory = (
  initialLines: string[] = [],
  settings: PromptHistorySettings = {},
): PromptHistory => {
  const history: PromptHistory = {
    limit: settings.limit ?? defaultHistoryLimit,
    prompts: [],
    browseIndex: null,
    draft: "",
  };

  for (const line of initialLines) addPrompt(history, line);

  return history;
};

export const addPrompt = (history: PromptHistory, prompt: string): void => {
  const trimmed = prompt.trim();

  const isPromptNotStorable = !canStorePrompt(history, trimmed);
  if (isPromptNotStorable) return;

  history.prompts.push(trimmed);
  trimToLimit(history);
  resetBrowsing(history);
};

const canStorePrompt = (history: PromptHistory, trimmed: string): boolean => {
  const isTrimmedEmpty = trimmed === "";
  if (isTrimmedEmpty) return false;

  return history.prompts.at(-1) !== trimmed;
};

const trimToLimit = (history: PromptHistory): void => {
  while (history.prompts.length > history.limit) history.prompts.shift();
};

const resetBrowsing = (history: PromptHistory): void => {
  history.browseIndex = null;
  history.draft = "";
};

export const listPrompts = (history: PromptHistory): string[] => [...history.prompts];

export const readPreviousPrompt = (history: PromptHistory, currentDraft: string): string => {
  const isPromptsEmpty = history.prompts.length === 0;
  if (isPromptsEmpty) return currentDraft;

  const { browseIndex } = history;
  const isBrowsingStarted = browseIndex == null;
  if (isBrowsingStarted) {
    history.draft = currentDraft;
    history.browseIndex = history.prompts.length - 1;
  } else {
    history.browseIndex = Math.max(0, browseIndex - 1);
  }

  const prompt = history.prompts[history.browseIndex];

  const isPromptMissing = prompt == null;
  if (isPromptMissing) return currentDraft;

  return prompt;
};

export const readNextPrompt = (history: PromptHistory): string => {
  const { browseIndex } = history;
  const isNotBrowsing = browseIndex == null;
  if (isNotBrowsing) return "";

  const isBrowsePastEnd = browseIndex >= history.prompts.length;
  if (isBrowsePastEnd) return history.draft;

  const isBrowsingOlder = browseIndex < history.prompts.length - 1;
  if (isBrowsingOlder) {
    history.browseIndex = browseIndex + 1;
    const prompt = history.prompts[history.browseIndex];

    const isPromptMissing = prompt == null;
    if (isPromptMissing) return history.draft;

    return prompt;
  }

  history.browseIndex = history.prompts.length;
  return history.draft;
};

export const reverseSearchQuery = (query: string): string | null => {
  const markerIndex = query.lastIndexOf(CTRL_R);

  const isMarkerNotFound = markerIndex === -1;
  if (isMarkerNotFound) return null;

  return query.slice(markerIndex + CTRL_R.length);
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
