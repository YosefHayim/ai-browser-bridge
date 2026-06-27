/** Strip surrounding YAML quotes from a scalar value. */
export function stripYamlQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Parse a comma-separated or bracketed inline YAML list. */
export function parseInlineList(value: string): string[] {
  const withoutBrackets = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return withoutBrackets.split(",").map((item) => stripYamlQuotes(item.trim())).filter(Boolean);
}

/** Trim leading and trailing blank lines from markdown bodies. */
export function trimOuterBlankLines(value: string): string {
  return value.replace(/^\n+/, "").replace(/\n+$/, "");
}
