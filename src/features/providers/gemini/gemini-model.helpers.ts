/** True when a string looks like a real Gemini model name. */
export function isLikelyModelLabel(value: string): boolean {
  return /\b(gemini|flash|pro|thinking|advanced|experimental)\b/i.test(value);
}

/** Normalize whitespace in display text scraped from the DOM. */
export function normalizeDisplayText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
