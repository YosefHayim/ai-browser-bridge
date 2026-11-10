const CTRL_R = "\u0012";

const DEFAULT_HISTORY_LIMIT = 100;

type PromptHistorySettings = {
  readonly limit?: number;
};

/** Shell-style prompt history with older/newer draft navigation. */
export class PromptHistory {
  private readonly limit: number;
  private readonly prompts: string[];
  private browseIndex: number | null = null;
  private draft = "";

  constructor(initialLines: string[] = [], settings: PromptHistorySettings = {}) {
    const isLimitMissing = settings.limit == null;
    if (isLimitMissing) this.limit = DEFAULT_HISTORY_LIMIT;
    else this.limit = settings.limit;

    this.prompts = [];
    for (const line of initialLines) this.add(line);
  }

  add(prompt: string): void {
    const trimmed = prompt.trim();
    const isPromptNotStorable = !this.canStorePrompt(trimmed);
    if (isPromptNotStorable) return;

    this.prompts.push(trimmed);
    this.trimToLimit();
    this.resetBrowsing();
  }

  private canStorePrompt(trimmed: string): boolean {
    const isTrimmedEmpty = trimmed === "";
    if (isTrimmedEmpty) return false;

    return this.prompts.at(-1) !== trimmed;
  }

  private trimToLimit(): void {
    while (this.prompts.length > this.limit) this.prompts.shift();
  }

  listPrompts(): string[] {
    return [...this.prompts];
  }

  readPreviousPrompt(currentDraft: string): string {
    const isPromptsEmpty = this.prompts.length === 0;
    if (isPromptsEmpty) return currentDraft;

    if (this.browseIndex == null) {
      this.draft = currentDraft;
      this.browseIndex = this.prompts.length - 1;
    } else {
      this.browseIndex = Math.max(0, this.browseIndex - 1);
    }

    const prompt = this.prompts[this.browseIndex];

    const isPromptMissing = prompt == null;
    if (isPromptMissing) return currentDraft;

    return prompt;
  }

  readNextPrompt(): string {
    if (this.browseIndex == null) return "";

    const isBrowsePastEnd = this.browseIndex >= this.prompts.length;
    if (isBrowsePastEnd) return this.draft;

    const isBrowsingOlder = this.browseIndex < this.prompts.length - 1;
    if (isBrowsingOlder) {
      this.browseIndex += 1;
      const prompt = this.prompts[this.browseIndex];

      const isPromptMissing = prompt == null;
      if (isPromptMissing) return this.draft;

      return prompt;
    }

    this.browseIndex = this.prompts.length;
    return this.draft;
  }

  resetBrowsing(): void {
    this.browseIndex = null;
    this.draft = "";
  }
}

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
