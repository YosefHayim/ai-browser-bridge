const PROVIDER_COLORS: Record<string, string> = {
  claude: "var(--c-claude)",
  deepseek: "var(--c-deepseek)",
  grok: "var(--c-grok)",
  chatgpt: "var(--c-chatgpt)",
  gemini: "var(--c-gemini)",
};

export const readProviderColor = (providerId: string): string =>
  PROVIDER_COLORS[providerId] ?? "var(--accent-text)";
