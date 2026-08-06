const CTRL_R = "\u0012";

const DEFAULT_HISTORY_LIMIT = 100;

type PromptHistoryOptions = {
  limit?: number;
};

/** Prompt history store with shell-style older/newer draft navigation. */
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

  /** Record a prompt, skipping empties and consecutive duplicates. */
  add(prompt: string): void {
    const trimmed = prompt.trim();
    if (!this.shouldStorePrompt(trimmed)) return;
    this.prompts.push(trimmed);
    this.trimToLimit();
    this.resetBrowsing();
  }

  /** Skip empty or duplicate consecutive prompts. */
  private shouldStorePrompt(trimmed: string): boolean {
    if (!trimmed) return false;
    return this.prompts.at(-1) !== trimmed;
  }

  /** Drop oldest entries when history exceeds the limit. */
  private trimToLimit(): void {
    while (this.prompts.length > this.limit) this.prompts.shift();
  }

  /** Snapshot of stored prompts, oldest first. */
  entries(): string[] {
    return [...this.prompts];
  }

  /** Step to the older prompt, stashing the live draft on the first step back. */
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

  /** Step toward newer prompts, returning to the stashed draft past the newest. */
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

  /** Exit history browsing and clear the stashed draft. */
  resetBrowsing(): void {
    this.browseIndex = undefined;
    this.draft = "";
  }
}

/** Query text after the last Ctrl+R reverse-search marker, if present. */
export const reverseSearchQuery = (input: string): string | undefined => {
  const markerIndex = input.lastIndexOf(CTRL_R);
  if (markerIndex === -1) return undefined;
  return input.slice(markerIndex + CTRL_R.length);
};

/** Newest history entry that includes the reverse-search query. */
export const reverseHistoryMatch = (
  entries: readonly string[],
  query: string,
): string | undefined => {
  const normalizedQuery = query.toLowerCase();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    if (normalizedQuery === "" || entry.toLowerCase().includes(normalizedQuery)) return entry;
  }
  return undefined;
};
