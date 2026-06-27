import type { CommandContext } from "../../../../domain/types.ts";
import { getLatestSession } from "../../../../store/session-store.ts";
import { formatSessionSummary } from "../../formatters.ts";
import { sessionStore } from "../helpers/session-store.ts";
import { tryLoadSession } from "../helpers/try-load-session.ts";

/** Resume a browser conversation or local bridge session. */
export async function handleResume(args: string, ctx: CommandContext): Promise<void> {
  const query = args.trim();
  if (!query) {
    console.log("Usage: /resume <number|title|id> or /resume --last (use /conversations or /sessions)");
    return;
  }
  if (query === "--last") {
    await resumeLatestSession(ctx);
    return;
  }
  if (await resumeLocalSession({ query, ctx })) return;
  await resumeBrowserConversation({ query, ctx });
}

/** Activate the most recently updated local session. */
async function resumeLatestSession(ctx: CommandContext): Promise<void> {
  const latest = await getLatestSession(sessionStore(ctx.config.repoPath));
  if (!latest) {
    console.log("No local bridge sessions found.");
    return;
  }
  await ctx.session?.setId(latest.metadata.id);
  console.log(formatSessionSummary(latest.metadata, ctx.session?.getId()));
}

/** Inputs for resuming a local session by id fragment. */
interface ResumeLocalSessionParams {
  /** Session id or fragment. */
  query: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Try to resume a local session; returns true when matched. */
async function resumeLocalSession(params: ResumeLocalSessionParams): Promise<boolean> {
  const localSession = await tryLoadSession({
    sessionId: params.query,
    options: sessionStore(params.ctx.config.repoPath),
  });
  if (!localSession) return false;
  await params.ctx.session?.setId(localSession.metadata.id);
  console.log(formatSessionSummary(localSession.metadata, params.ctx.session?.getId()));
  return true;
}

/** Inputs for resuming a browser sidebar conversation. */
interface ResumeBrowserConversationParams {
  /** Number, id, or title fragment. */
  query: string;
  /** Active command context. */
  ctx: CommandContext;
}

/** Navigate to a numbered or named browser conversation. */
async function resumeBrowserConversation(params: ResumeBrowserConversationParams): Promise<void> {
  const conversations = await params.ctx.orchestrator.listConversations();
  const target = findBrowserConversation({ conversations, query: params.query });
  if (!target) {
    console.log(`No conversation matching "${params.query}". Use /conversations to see the list.`);
    return;
  }
  console.log(`Resuming: ${target.title}`);
  await params.ctx.orchestrator.navigateToConversation(target.url);
}

/** Match a browser conversation by number, id, or title fragment. */
function findBrowserConversation(input: {
  conversations: Array<{ id: string; title: string; url: string }>;
  query: string;
}): { id: string; title: string; url: string } | undefined {
  const num = parseInt(input.query, 10);
  if (Number.isNaN(num)) {
    return input.conversations.find(
      (conversation) => conversation.id.toLowerCase().includes(input.query.toLowerCase())
        || conversation.title.toLowerCase().includes(input.query.toLowerCase()),
    );
  }
  return input.conversations[num - 1];
}
