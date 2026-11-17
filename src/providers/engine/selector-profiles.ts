import { type BridgeProviderId, PROVIDER_SETTINGS } from "@/provider-settings.ts";
import type { ProviderProfile } from "@/providers/engine/browser-provider.ts";

function createSelectorProfile(providerId: BridgeProviderId) {
  const settings = PROVIDER_SETTINGS[providerId];
  return {
    id: providerId,
    origin: settings.origin,
    defaultUrl: settings.defaultUrl,
    defaultModel: settings.defaultModel,
    displayName: settings.displayName,
    composerSelector: settings.selectors.composer,
    supportsMcpConnector: settings.supportsMcpConnector,
  } satisfies ProviderProfile;
}

export type SelectorDrivenProfile = ReturnType<typeof createSelectorProfile>;

export const claudeProfile = createSelectorProfile("claude");

export const deepseekProfile = createSelectorProfile("deepseek");

export const grokProfile = createSelectorProfile("grok");

export const perplexityProfile = createSelectorProfile("perplexity");

export const duckProfile = createSelectorProfile("duck");
