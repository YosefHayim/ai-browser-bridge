import { sessionsDir } from "../../../../store/paths.ts";
import type { SessionStoreOptions } from "../../../../store/session-store.ts";

/** Session-store options scoped to a repo's `.bridge/sessions`. */
export function sessionStore(repoPath: string): SessionStoreOptions {
  return { baseDir: sessionsDir(repoPath) };
}
