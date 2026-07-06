import type { BridgeProviderId } from "@/config";
import { Data } from "effect";

/**
 * Error raised when a provider id is not part of the configured provider table.
 */
export class UnknownProviderError extends Data.TaggedError("UnknownProviderError")<{
  readonly value: string;
  readonly validProviders: readonly BridgeProviderId[];
}> {
  override get message(): string {
    return `Unknown provider "${this.value}". Valid providers: ${this.validProviders.join(", ")}.`;
  }
}

/**
 * Error raised when a provider page is still showing an unauthenticated shell.
 */
export class GuestSessionError extends Data.TaggedError("GuestSessionError")<{
  readonly providerId: BridgeProviderId;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.providerId} is not signed in: ${this.reason}`;
  }
}
