/** Thrown when ChatGPT shows the guest login wall instead of a signed-in session. */
export class GuestSessionError extends Error {
  constructor() {
    super(
      "ChatGPT is in guest mode (Log in button visible). " +
        "This is the bridge's isolated Chrome — not your daily browser. " +
        "Click Log in in that window, complete sign-in, leave it open, then run again.",
    );
    this.name = "GuestSessionError";
  }
}
