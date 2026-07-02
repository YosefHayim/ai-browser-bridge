/** Thrown when a provider shows its unauthenticated sign-in shell. */
export class GuestSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuestSessionError";
  }
}
