import { type BridgeProviderId, PROVIDER_CONFIG } from "@/config";

/**
 * Resolve a provider id to its human-readable display name.
 *
 * @param id - Id value.
 * @returns The `getProviderDisplayName` result.
 * @example
 * ```ts
 * const result = getProviderDisplayName(id);
 * ```
 */
export const getProviderDisplayName = (id: BridgeProviderId): string => {
  return PROVIDER_CONFIG[id].displayName;
};
