/** Raised when a requested provider id/alias is not in the registry. */
export class UnknownProviderError extends Error {
  constructor(value: string, valid: readonly string[]) {
    super(`Unknown provider "${value}". Valid providers: ${valid.join(", ")}.`);
    this.name = "UnknownProviderError";
  }
}
