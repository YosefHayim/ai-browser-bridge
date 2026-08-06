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
    if (options.limit === undefined) this.limit = DEFAULT_HISTORY_LIMIT;
    else this.limit = options.limit;
    this.prompts = [];
    for (const entry of initialEntries) this.add(entry);
  }

  add(prompt: string): void {
    const trimmed = prompt.trim();
    if (!this.shouldStorePrompt(trimmed)) return;
    this.prompts.push(trimmed);
    this.trimToLimit();
    this.resetBrowsing();
  }

  private shouldStorePrompt(trimmed: string): boolean {
    if (trimmed === "") return false;
    return this.prompts.at(-1) !== trimmed;
  }

  private trimToLimit(): void {
    while (this.prompts.length > this.limit) this.prompts.shift();
  }

  entries(): string[] {
    return [...this.prompts];
  }

  previous(currentDraft: string): string {
    if (this.prompts.length === 0) return currentDraft;
    if (this.browseIndex === undefined) {
      this.draft = currentDraft;
      this.browseIndex = this.prompts.length - 1;
    } else {
      this.browseIndex = Math.max(0, this.browseIndex - 1);
    }
    const prompt = this.prompts[this.browseIndex];
    if (prompt === undefined) return currentDraft;
    return prompt;
  }

  next(): string {
    if (this.browseIndex === undefined) return "";
    if (this.browseIndex >= this.prompts.length) return this.draft;
    if (this.browseIndex < this.prompts.length - 1) {
      this.browseIndex += 1;
      const prompt = this.prompts[this.browseIndex];
      if (prompt === undefined) return this.draft;
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
  if (markerIndex === -1) return undefined;
  return input.slice(markerIndex + CTRL_R.length);
};

export const reverseHistoryMatch = (
  entries: readonly string[],
  query: string,
): string | undefined => {
  const normalizedQuery = query.toLowerCase();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (normalizedQuery === "" || entry.toLowerCase().includes(normalizedQuery)) return entry;
  }
  return undefined;
};
