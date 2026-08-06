import { type BridgeProviderId, PROVIDER_CONFIG } from "@/config";

/** Resolve a provider id to its human-readable display name. */
export const providerDisplayName = (id: BridgeProviderId): string => {
  return PROVIDER_CONFIG[id].displayName;
};
