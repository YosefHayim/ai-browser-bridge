import { Command } from "commander";
import { CliRunner, runDownload } from "./cli-runner.class.ts";
import { subcommandOpts } from "./subcommand-opts.ts";

/** Register all bridge CLI commands on a Commander program. */
export function registerCliCommands(program: Command, runner = new CliRunner()): void {
  program
    .name("bridge")
    .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
    .version("0.1.0")
    .option("-r, --repo <path>", "Path to the target repository (default: cwd)")
    .option("-p, --port <number>", "MCP server port (default: 8765)")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .option("--no-browser", "Skip Chrome browser connection")
    .action((...args: unknown[]) => handleDefaultAction(args, runner));
  registerHeadlessCommands(program, runner);
}

/** Register non-interactive headless subcommands. */
function registerHeadlessCommands(program: Command, runner: CliRunner): void {
  program
    .command("ask <prompt...>")
    .description("Send one prompt and print the reply (non-interactive)")
    .option("-r, --repo <path>", "Target repository for MCP tools")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .option("--json", "Emit a JSON object { sessionId, model, reply, contextTokens }")
    .option("--tools", "Start the tunnel + connector so ChatGPT can call local tools (ChatGPT only)")
    .option("--fresh", "Start a new conversation before asking")
    .option("--conversation <idOrUrl>", "Open a ChatGPT conversation by id or URL before asking")
    .option("--model <name>", "Switch model before asking")
    .option("--timeout <seconds>", "Max seconds to wait for the reply (default 300)")
    .option("--attach <path...>", "Attach repo-relative image file(s) before asking")
    .action((...args: unknown[]) => handleAskAction(args, runner));
  program
    .command("download")
    .description("Download a conversation's attachments/images (non-interactive, ChatGPT only)")
    .option("-r, --repo <path>", "Target repository")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .option("--conversation <id>", "Conversation id (default: current page)")
    .option("--out <dir>", "Output directory (default: ./downloads/<id>)")
    .option("--id <attachmentId...>", "Specific attachment id(s); omit to download all")
    .option("--scan", "Rescan conversation attachments into manifest without downloading")
    .option("--json", "Emit a JSON array of results")
    .action((...args: unknown[]) => handleDownloadAction(args));
  program.command("sessions").description("List stored bridge sessions as JSON").action(() => runner.runSessions());
  program
    .command("login")
    .description("Open the bridge Chrome profile to sign in once")
    .option("-r, --repo <path>", "Target repository for the bridge Chrome profile")
    .option("--provider <name>", "Browser provider: chatgpt or gemini (default: chatgpt)")
    .action((...args: unknown[]) => handleLoginAction(args, runner));
  program.command("stop").description("Close the warm bridge browser").action(() => runner.runStop());
}

/** Run default `bridge` TUI from Commander action arguments. */
function handleDefaultAction(args: unknown[], runner: CliRunner): void {
  const command = args.at(-1) as Command;
  void runner.runDefault(command.opts());
}

/**
 * Run `bridge ask` from Commander action arguments.
 *
 * For a variadic `<prompt...>`, Commander calls the action with
 * `(promptParts, options, command)` — the prompt words are the first argument,
 * not every argument before the command. Joining `args.slice(0, -1)` instead
 * swept the options object into the prompt, appending a literal `[object
 * Object]` to whatever the user asked.
 */
function handleAskAction(args: unknown[], runner: CliRunner): void {
  const command = args.at(-1) as Command;
  const promptParts = (args[0] ?? []) as string[];
  void runner.runAsk(promptParts.join(" "), subcommandOpts(command));
}

/** Run `bridge download` from Commander action arguments. */
function handleDownloadAction(args: unknown[]): void {
  const command = args.at(-1) as Command;
  void runDownload(subcommandOpts(command));
}

/** Run `bridge login` from Commander action arguments. */
function handleLoginAction(args: unknown[], runner: CliRunner): void {
  const command = args.at(-1) as Command;
  void runner.runLogin(subcommandOpts(command));
}
