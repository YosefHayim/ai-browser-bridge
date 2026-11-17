const PROVIDER_COLORS: Record<string, string> = {
  claude: "var(--c-claude)",
  deepseek: "var(--c-deepseek)",
  grok: "var(--c-grok)",
  chatgpt: "var(--c-chatgpt)",
  gemini: "var(--c-gemini)",
};

export function readProviderColor(providerId: string): string {
  return PROVIDER_COLORS[providerId] ?? "var(--accent-text)";
}
