import { type BridgeProviderId, PROVIDER_SETTINGS } from "@/config";

export const readProviderDisplayName = (id: BridgeProviderId): string => {
  return PROVIDER_SETTINGS[id].displayName;
};
