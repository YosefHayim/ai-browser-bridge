const CTRL_R = "\u0012";

const DEFAULT_HISTORY_LIMIT = 100;

interface PromptHistoryOptions {
  limit?: number;
}

/** Prompt history store with shell-style older/newer draft navigation. */
export class PromptHistory {
  private readonly limit: number;
  private readonly prompts: string[];
  private browseIndex: number | null = null;
  private draft = "";

  constructor(initialEntries: string[] = [], options: PromptHistoryOptions = {}) {
    this.limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
    this.prompts = [];
    for (const entry of initialEntries) this.add(entry);
  }

  /**
   * Record a prompt, skipping empties and consecutive duplicates.
   *
   * @param prompt - Prompt text for the method.
   * @returns Completes when `add` finishes.
   * @example
   * ```ts
   * promptHistory.add(prompt);
   * ```
   */
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

  /**
   * Snapshot of stored prompts, oldest first.
   *
   * @returns The `entries` result.
   * @example
   * ```ts
   * const result = promptHistory.entries();
   * ```
   */
  entries(): string[] {
    return [...this.prompts];
  }

  /**
   * Step to the older prompt, stashing the live draft on the first step back.
   *
   * @param currentDraft - Current draft value.
   * @returns The `previous` result.
   * @example
   * ```ts
   * const result = promptHistory.previous(currentDraft);
   * ```
   */
  previous(currentDraft: string): string {
    if (this.prompts.length === 0) return currentDraft;
    if (this.browseIndex === null) {
      this.draft = currentDraft;
      this.browseIndex = this.prompts.length - 1;
    } else {
      this.browseIndex = Math.max(0, this.browseIndex - 1);
    }
    return this.prompts[this.browseIndex] ?? currentDraft;
  }

  /**
   * Step toward newer prompts, returning to the stashed draft past the newest.
   *
   * @returns The `next` result.
   * @example
   * ```ts
   * const result = promptHistory.next();
   * ```
   */
  next(): string {
    if (this.browseIndex === null) return "";
    if (this.browseIndex >= this.prompts.length) return this.draft;
    if (this.browseIndex < this.prompts.length - 1) {
      this.browseIndex += 1;
      return this.prompts[this.browseIndex] ?? this.draft;
    }
    this.browseIndex = this.prompts.length;
    return this.draft;
  }

  /**
   * Exit history browsing and clear the stashed draft.
   *
   * @returns Completes when `resetBrowsing` finishes.
   * @example
   * ```ts
   * promptHistory.resetBrowsing();
   * ```
   */
  resetBrowsing(): void {
    this.browseIndex = null;
    this.draft = "";
  }
}

/**
 * create prompt history.
 *
 * @param options - Options that configure the operation.
 * @returns The `createPromptHistory` result.
 * @example
 * ```ts
 * const result = createPromptHistory(options);
 * ```
 */
export const createPromptHistory = (options: PromptHistoryOptions = {}): PromptHistory => {
  return new PromptHistory([], options);
};

/**
 * Get reverse search query.
 *
 * @param input - Input values for the operation.
 * @returns The `getReverseSearchQuery` result.
 * @example
 * ```ts
 * const result = getReverseSearchQuery(input);
 * ```
 */
export const getReverseSearchQuery = (input: string): string | null => {
  const markerIndex = input.lastIndexOf(CTRL_R);
  if (markerIndex === -1) return null;
  return input.slice(markerIndex + CTRL_R.length);
};

/**
 * find reverse history match.
 *
 * @param entries - Entries value.
 * @param query - Query value.
 * @returns The `findReverseHistoryMatch` result.
 * @example
 * ```ts
 * const result = findReverseHistoryMatch(entries, query);
 * ```
 */
export const findReverseHistoryMatch = (entries: string[], query: string): string | null => {
  const normalizedQuery = query.toLowerCase();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    if (normalizedQuery === "" || entry.toLowerCase().includes(normalizedQuery)) return entry;
  }
  return null;
};
