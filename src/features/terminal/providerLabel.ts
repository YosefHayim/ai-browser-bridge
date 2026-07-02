import { PROVIDER_CONFIG } from "../../config/providersConfig.ts";
import type { BridgeProviderId } from "../providers/createProviderFactory.ts";

/** Resolve a provider id to its human-readable display name. */
export function getProviderDisplayName(id: BridgeProviderId): string {
  const entry = PROVIDER_CONFIG.find((p) => p.id === id);
  return entry?.displayName ?? id;
}
