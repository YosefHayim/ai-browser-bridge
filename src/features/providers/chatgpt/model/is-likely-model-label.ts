/** True when a string looks like a real ChatGPT model name (vs. arbitrary UI text). */
export function isLikelyModelLabel(value: string): boolean {
  return /\b(gpt|chatgpt|o[1-9]|claude|glm)\b/i.test(value);
}
