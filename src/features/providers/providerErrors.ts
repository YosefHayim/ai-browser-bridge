import { Data } from "effect";
import type { BridgeProviderId } from "@/config";

export class UnknownProviderError extends Data.TaggedError("UnknownProviderError")<{
  readonly value: string;
  readonly validProviders: readonly BridgeProviderId[];
}> {
  override get message(): string {
    return `Unknown provider "${this.value}". Valid providers: ${this.validProviders.join(", ")}.`;
  }
}

export class GuestSessionError extends Data.TaggedError("GuestSessionError")<{
  readonly providerId: BridgeProviderId;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.providerId} is not signed in: ${this.reason}`;
  }
}
