import type { BridgeProviderId } from "@/provider-settings.ts";

interface UnknownProviderDetails {
  readonly value: string;
  readonly validProviders: readonly BridgeProviderId[];
}

interface GuestSessionDetails {
  readonly providerId: BridgeProviderId;
  readonly reason: string;
}

export function createUnknownProviderError(details: UnknownProviderDetails): Error {
  return new Error(
    `Unknown provider "${details.value}". Valid providers: ${details.validProviders.join(", ")}.`,
  );
}

export function createGuestSessionError(details: GuestSessionDetails): Error {
  return new Error(`${details.providerId} is not signed in: ${details.reason}`);
}
