import { Command } from "commander";
import { runAsk, runDownload, runLogin, runSessions, runStop } from "./headless.ts";
import { runTui } from "./run-tui.ts";

/** Register all bridge CLI commands on a Commander program. */
export function registerCliCommands(program: Command): void {
  program
    .name("bridge")
    .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
    .version("0.1.0")
    .option("-r, --repo <path>", "Path to the target repository (default: cwd)")
    .option("-p, --port <number>", "MCP server port (default: 8765)")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .option("--no-browser", "Skip Chrome browser connection")
    .action(runTui);
  registerHeadlessCommands(program);
}

/** Register non-interactive headless subcommands. */
function registerHeadlessCommands(program: Command): void {
  program
    .command("ask <prompt...>")
    .description("Send one prompt and print the reply (non-interactive)")
    .option("-r, --repo <path>", "Target repository for MCP tools")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .option("--json", "Emit a JSON object { sessionId, model, reply, contextTokens }")
    .option("--tools", "Start the tunnel + connector so ChatGPT can call local tools (ChatGPT only)")
    .option("--fresh", "Start a new conversation before asking")
    .option("--model <name>", "Switch model before asking")
    .option("--timeout <seconds>", "Max seconds to wait for the reply (default 300)")
    .action((...args: [string[], Parameters<typeof runAsk>[1]]) => runAsk(args[0].join(" "), args[1]));
  program
    .command("download")
    .description("Download a conversation's attachments/images (non-interactive, ChatGPT only)")
    .option("-r, --repo <path>", "Target repository")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .option("--conversation <id>", "Conversation id (default: current page)")
    .option("--out <dir>", "Output directory (default: ./downloads/<id>)")
    .option("--id <attachmentId...>", "Specific attachment id(s); omit to download all")
    .option("--json", "Emit a JSON array of results")
    .action(runDownload);
  program.command("sessions").description("List stored bridge sessions as JSON").action(runSessions);
  program
    .command("login")
    .description("Open the bridge Chrome profile to sign in once")
    .option("-r, --repo <path>", "Target repository for the bridge Chrome profile")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .action((options: { repo?: string; provider?: string }) => runLogin(options));
  program.command("stop").description("Close the warm bridge browser").action(runStop);
}
