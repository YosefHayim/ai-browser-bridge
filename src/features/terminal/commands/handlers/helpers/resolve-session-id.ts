import type { CommandContext } from "../../../../domain/types.ts";
import { getLatestSession } from "../../../../store/session-store.ts";
import { splitArgs } from "./split-args.ts";
import { sessionStore } from "./session-store.ts";

/** Inputs for resolving which session a command targets. */
export interface ResolveSessionIdParams {
  /** Raw command arguments. */
  args: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Resolve session id from explicit arg, current session, or latest. */
export async function resolveSessionId(params: ResolveSessionIdParams): Promise<string | null> {
  const [requested] = splitArgs(params.args);
  if (requested) return requested;
  if (params.ctx.session?.getId()) return params.ctx.session.getId();
  const latest = await getLatestSession(sessionStore(params.ctx.config.repoPath));
  return latest?.metadata.id ?? null;
}
