import { type BridgeProviderId, PROVIDER_CONFIG } from "@/config";

export const providerDisplayName = (id: BridgeProviderId): string => {
  return PROVIDER_CONFIG[id].displayName;
};
