import { loadSession, type SessionStoreOptions } from "../../../../store/session-store.ts";

/** Parameters for loading a session without throwing. */
export interface TryLoadSessionParams {
  /** Session id to load. */
  sessionId: string;
  /** Session store scoped to the repo. */
  options: SessionStoreOptions;
}

/** Load a session by id, returning null instead of throwing when it is missing. */
export async function tryLoadSession(params: TryLoadSessionParams) {
  try {
    return await loadSession(params.sessionId, params.options);
  } catch {
    return null;
  }
}
