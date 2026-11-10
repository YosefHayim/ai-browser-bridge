import { type BridgeProviderId, PROVIDER_CONFIG } from "@/config";

export const readProviderDisplayName = (id: BridgeProviderId): string => {
  return PROVIDER_CONFIG[id].displayName;
};
