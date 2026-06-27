import type { CommandContext } from "../../../../domain/types.ts";
import { listSessions } from "../../../../store/session-store.ts";
import { sessionStore } from "../helpers/session-store.ts";

/** List local bridge sessions with current-session marker. */
export async function handleSessions(_args: string, ctx: CommandContext): Promise<void> {
  const sessions = await listSessions(sessionStore(ctx.config.repoPath));
  if (sessions.length === 0) {
    console.log("No local bridge sessions found.");
    return;
  }
  printSessionRows({ sessions, currentId: ctx.session?.getId() });
}

/** Inputs for printing the session table. */
interface PrintSessionRowsParams {
  /** Session metadata rows. */
  sessions: Array<{ id: string; updatedAt: string; model?: string | null; repoPath: string }>;
  /** Currently active session id, if any. */
  currentId?: string;
}

/** Print up to 20 local sessions with a current-session marker. */
function printSessionRows(params: PrintSessionRowsParams): void {
  console.log("\nLocal sessions:\n");
  for (const session of params.sessions.slice(0, 20)) {
    const marker = session.id === params.currentId ? "*" : " ";
    console.log(
      `${marker} ${session.id.padEnd(38)} ${session.updatedAt} ${session.model ?? "unknown"} ${session.repoPath}`,
    );
  }
  console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
}
