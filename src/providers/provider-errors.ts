import type { BridgeProviderId } from "@/config";

interface UnknownProviderDetails {
  readonly value: string;
  readonly validProviders: readonly BridgeProviderId[];
}

interface GuestSessionDetails {
  readonly providerId: BridgeProviderId;
  readonly reason: string;
}

export const createUnknownProviderError = (details: UnknownProviderDetails): Error =>
  new Error(
    `Unknown provider "${details.value}". Valid providers: ${details.validProviders.join(", ")}.`,
  );

export const createGuestSessionError = (details: GuestSessionDetails): Error =>
  new Error(`${details.providerId} is not signed in: ${details.reason}`);
