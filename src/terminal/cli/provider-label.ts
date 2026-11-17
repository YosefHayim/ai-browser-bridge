import { type BridgeProviderId, PROVIDER_SETTINGS } from "@/provider-settings.ts";

export const readProviderDisplayName = (id: BridgeProviderId): string => {
  return PROVIDER_SETTINGS[id].displayName;
};
