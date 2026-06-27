import type { CommandContext } from "../../../../domain/types.ts";

/** List sidebar conversations or navigate when a query is provided. */
export async function handleConversations(args: string, ctx: CommandContext): Promise<void> {
  const conversations = await ctx.orchestrator.listConversations();
  if (conversations.length === 0) {
    console.log("No conversations found in sidebar.");
    return;
  }
  if (args.trim()) {
    await openMatchingConversation({ query: args.trim(), conversations, ctx });
    return;
  }
  printConversationList(conversations);
}

/** Inputs for opening a conversation by id or title fragment. */
interface OpenMatchingConversationParams {
  /** User search query. */
  query: string;
  /** Sidebar conversations. */
  conversations: Array<{ id: string; title: string; url: string }>;
  /** Active command context. */
  ctx: CommandContext;
}

/** Navigate to the first conversation matching the query. */
async function openMatchingConversation(params: OpenMatchingConversationParams): Promise<void> {
  const needle = params.query.toLowerCase();
  const match = params.conversations.find(
    (c) => c.id.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle),
  );
  if (match) {
    console.log(`Navigating to: ${match.title} (${match.id})`);
    await params.ctx.orchestrator.navigateToConversation(match.url);
    return;
  }
  console.log(`No conversation matching "${params.query}".`);
}

/** Print numbered conversation titles for `/resume`. */
function printConversationList(
  conversations: Array<{ id: string; title: string }>,
): void {
  console.log("\nChatGPT Conversations:\n");
  for (let i = 0; i < conversations.length; i++) {
    console.log(`  ${String(i + 1).padStart(2)}. ${conversations[i].title}`);
  }
  console.log("\nUse /resume <number> to continue a conversation.\n");
}
