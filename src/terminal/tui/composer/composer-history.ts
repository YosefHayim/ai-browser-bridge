const CTRL_R = "\u0012";

const DEFAULT_HISTORY_LIMIT = 100;

type PromptHistoryOptions = {
  readonly limit?: number;
};

/** Shell-style prompt history with older/newer draft navigation. */
export class PromptHistory {
  private readonly limit: number;
  private readonly prompts: string[];
  private browseIndex: number | undefined = undefined;
  private draft = "";

  constructor(initialEntries: string[] = [], options: PromptHistoryOptions = {}) {
    const isLimitMissing = options.limit === undefined;
    if (isLimitMissing) this.limit = DEFAULT_HISTORY_LIMIT;
    else this.limit = options.limit;

    this.prompts = [];
    for (const entry of initialEntries) this.add(entry);
  }

  add(prompt: string): void {
    const trimmed = prompt.trim();
    const isNotTrimmedStorePrompt = !this.shouldStorePrompt(trimmed);
    if (isNotTrimmedStorePrompt) return;

    this.prompts.push(trimmed);
    this.trimToLimit();
    this.resetBrowsing();
  }

  private shouldStorePrompt(trimmed: string): boolean {
    const isTrimmedEmpty = trimmed === "";
    if (isTrimmedEmpty) return false;

    return this.prompts.at(-1) !== trimmed;
  }

  private trimToLimit(): void {
    while (this.prompts.length > this.limit) this.prompts.shift();
  }

  entries(): string[] {
    return [...this.prompts];
  }

  previous(currentDraft: string): string {
    const isPromptsEmpty = this.prompts.length === 0;
    if (isPromptsEmpty) return currentDraft;

    if (this.browseIndex === undefined) {
      this.draft = currentDraft;
      this.browseIndex = this.prompts.length - 1;
    } else {
      this.browseIndex = Math.max(0, this.browseIndex - 1);
    }

    const prompt = this.prompts[this.browseIndex];

    const isPromptMissing = prompt === undefined;
    if (isPromptMissing) return currentDraft;

    return prompt;
  }

  next(): string {
    if (this.browseIndex === undefined) return "";

    const isBrowsePastEnd = this.browseIndex >= this.prompts.length;
    if (isBrowsePastEnd) return this.draft;

    const isBrowsingOlder = this.browseIndex < this.prompts.length - 1;
    if (isBrowsingOlder) {
      this.browseIndex += 1;
      const prompt = this.prompts[this.browseIndex];

      const isPromptMissing = prompt === undefined;
      if (isPromptMissing) return this.draft;

      return prompt;
    }

    this.browseIndex = this.prompts.length;
    return this.draft;
  }

  resetBrowsing(): void {
    this.browseIndex = undefined;
    this.draft = "";
  }
}

export const reverseSearchQuery = (input: string): string | undefined => {
  const markerIndex = input.lastIndexOf(CTRL_R);
  const isMarkerIndexEqualsMinus1 = markerIndex === -1;
  if (isMarkerIndexEqualsMinus1) return undefined;

  return input.slice(markerIndex + CTRL_R.length);
};

export const reverseHistoryMatch = (
  entries: readonly string[],
  query: string,
): string | undefined => {
  const normalizedQuery = query.toLowerCase();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const isEntryMissing = entry === undefined;
    if (isEntryMissing) continue;

    const isEntryMatchingQuery =
      normalizedQuery === "" || entry.toLowerCase().includes(normalizedQuery);
    if (isEntryMatchingQuery) return entry;
  }
  return undefined;
};
