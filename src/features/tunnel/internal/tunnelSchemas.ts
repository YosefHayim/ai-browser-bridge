import { Data } from "effect";

/**
 * Error raised when the Cloudflare Tunnel fails to start or times out.
 *
 * @param message - Human-readable description of the failure.
 */
export class CloudflareTunnelError extends Data.TaggedError("CloudflareTunnelError")<{
  readonly message: string;
}> {}
