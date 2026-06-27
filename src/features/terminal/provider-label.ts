import { PROVIDER_CONFIG } from "../../config/providers.config.ts";
import type { BridgeProviderId } from "../providers/create-provider.factory.ts";

/** Resolve a provider id to its human-readable display name. */
export function getProviderDisplayName(id: BridgeProviderId): string {
  const entry = PROVIDER_CONFIG.find((p) => p.id === id);
  return entry?.displayName ?? id;
}
