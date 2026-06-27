import type { Page } from "playwright";
import { GuestSessionError } from "../guest-session-error.ts";
import { isGuestSession } from "./is-guest-session.ts";

/** Fail fast before sending a prompt to an unauthenticated guest session. */
export async function assertSignedIn(page: Page): Promise<void> {
  if (await isGuestSession(page)) throw new GuestSessionError();
}
