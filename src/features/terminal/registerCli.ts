import { DEFAULT_ASK_TIMEOUT_SECONDS } from "@/config";
import { DEFAULT_PROVIDER, PROVIDER_IDS } from "@/features/providers";
import type { Command } from "commander";
import type { ChatCmdOptions, ProjectCmdOptions, TaskCmdOptions } from "./cliTypes.ts";
import {
  CliRunner,
  runChatList,
  runChatMove,
  runDownload,
  runProjectCreate,
  runProjectList,
  runServe,
  runTaskCreate,
  runTaskList,
} from "./internal/cliRunner.ts";
import { subcommandOpts } from "./subcommandOpts.ts";

/** `--provider` help text, derived from the registry so it never goes stale. */
const PROVIDER_OPTION = `Browser provider: ${PROVIDER_IDS.join(", ")} (default: ${DEFAULT_PROVIDER})`;

/** Register all bridge CLI commands on a Commander program. */
export function registerCliCommands(program: Command, runner = new CliRunner()): void {
  program
    .name("bridge")
    .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
    .version("0.1.0")
    .option("-r, --repo <path>", "Path to the target repository (default: cwd)")
    .option("-p, --port <number>", "MCP server port (default: 8765)")
    .option("--provider <name>", PROVIDER_OPTION)
    .option("--no-browser", "Skip Chrome browser connection")
    .action((...args: unknown[]) => handleDefaultAction(args, runner));
  registerHeadlessCommands(program, runner);
  registerWorkspaceCommands(program);
}

/** Register non-interactive headless subcommands. */
function registerHeadlessCommands(program: Command, runner: CliRunner): void {
  program
    .command("ask <prompt...>")
    .description("Send one prompt and print the reply (non-interactive)")
    .option("-r, --repo <path>", "Target repository for MCP tools")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <names>", `${PROVIDER_OPTION}; comma-separated for fan-out`)
    .option("--strict", "Fan-out: exit non-zero if any provider fails (default: only if all fail)")
    .option("--json", "Emit a JSON object { sessionId, model, reply, contextTokens }")
    .option(
      "--tools",
      "Start the tunnel + connector so ChatGPT can call local tools (ChatGPT only)",
    )
    .option("--fresh", "Start a new conversation before asking")
    .option("--conversation <idOrUrl>", "Open a ChatGPT conversation by id or URL before asking")
    .option("--model <name>", "Switch model before asking")
    .option(
      "--timeout <seconds>",
      `Max seconds to wait for the reply (default ${DEFAULT_ASK_TIMEOUT_SECONDS})`,
    )
    .option("--attach <path...>", "Attach repo-relative image file(s) before asking")
    .option(
      "--images <count>",
      "Wait for ChatGPT to finish generating this many images before returning",
    )
    .action((...args: unknown[]) => handleAskAction(args, runner));
  program
    .command("download")
    .description("Download a conversation's attachments/images (non-interactive, ChatGPT only)")
    .option("-r, --repo <path>", "Target repository")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", PROVIDER_OPTION)
    .option("--conversation <id>", "Conversation id (default: current page)")
    .option("--out <dir>", "Output directory (default: ./downloads/<id>)")
    .option("--id <attachmentId...>", "Specific attachment id(s); omit to download all")
    .option("--scan", "Rescan conversation attachments into manifest without downloading")
    .option("--json", "Emit a JSON array of results")
    .action((...args: unknown[]) => handleDownloadAction(args));
  program
    .command("sessions")
    .description("List stored bridge sessions as JSON")
    .action(() => runner.runSessions());
  program
    .command("login")
    .description("Open the bridge Chrome profile to sign in once")
    .option("-r, --repo <path>", "Target repository for the bridge Chrome profile")
    .option("--provider <name>", PROVIDER_OPTION)
    .action((...args: unknown[]) => handleLoginAction(args, runner));
  program
    .command("stop")
    .description("Close the warm bridge browser")
    .action(() => runner.runStop());
  program
    .command("serve")
    .description("Serve the outbound MCP `ask` tool over stdio so other agents can drive web chats")
    .option("-r, --repo <path>", "Target repository for the bridge Chrome profile")
    .option(
      "--timeout <seconds>",
      "Default per-provider reply timeout when an `ask` caller omits one",
    )
    .action((...args: unknown[]) => handleServeAction(args));
}

/** Attach the shared repo/port/provider/json flags to a workspace leaf command. */
function withWorkspaceFlags(command: Command): Command {
  return command
    .option("-r, --repo <path>", "Target repository for the bridge Chrome profile")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", PROVIDER_OPTION)
    .option("--json", "Emit JSON instead of human-readable lines");
}

/** Register `project`, `chat`, and `task` workspace subcommands (ChatGPT only). */
function registerWorkspaceCommands(program: Command): void {
  const project = program.command("project").description("Manage ChatGPT Projects (ChatGPT only)");
  withWorkspaceFlags(project.command("list"))
    .description("List ChatGPT Projects")
    .action((...args: unknown[]) => handleWorkspace<ProjectCmdOptions>(args, runProjectList));
  withWorkspaceFlags(project.command("create <name...>"))
    .description("Create a ChatGPT Project")
    .option("--instructions <text>", "Optional project instructions")
    .action((...args: unknown[]) => handleWorkspaceArg<ProjectCmdOptions>(args, runProjectCreate));

  const chat = program
    .command("chat")
    .description("List or organize ChatGPT conversations (ChatGPT only)");
  withWorkspaceFlags(chat.command("list"))
    .description("List sidebar (project-less) conversations")
    .option("--orphans", "List only loose, project-less conversations")
    .action((...args: unknown[]) => handleWorkspace<ChatCmdOptions>(args, runChatList));
  withWorkspaceFlags(chat.command("move <idOrTitle...>"))
    .description("Move a conversation into a Project")
    .option("--project <name>", "Destination project name")
    .action((...args: unknown[]) => handleWorkspaceArg<ChatCmdOptions>(args, runChatMove));

  const task = program.command("task").description("List or schedule ChatGPT Tasks (ChatGPT only)");
  withWorkspaceFlags(task.command("list"))
    .description("List ChatGPT Scheduled tasks")
    .action((...args: unknown[]) => handleWorkspace<TaskCmdOptions>(args, runTaskList));
  withWorkspaceFlags(task.command("create <prompt...>"))
    .description("Schedule a task via natural language")
    .option("--every <spec>", "Recurring cadence (e.g. day, or weekday at 9am)")
    .option("--at <spec>", "One-off run time (e.g. tomorrow at 9am)")
    .action((...args: unknown[]) => handleWorkspaceArg<TaskCmdOptions>(args, runTaskCreate));
}

/** Run a no-positional workspace verb from Commander action arguments. */
function handleWorkspace<T extends object>(
  args: unknown[],
  run: (options: T) => Promise<void>,
): void {
  const command = args.at(-1) as Command;
  void run(command.optsWithGlobals() as T);
}

/** Run a variadic-positional workspace verb (name/title/prompt) from Commander action arguments. */
function handleWorkspaceArg<T extends object>(
  args: unknown[],
  run: (value: string, options: T) => Promise<void>,
): void {
  const command = args.at(-1) as Command;
  const parts = (args[0] ?? []) as string[];
  void run(parts.join(" "), command.optsWithGlobals() as T);
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

/** Run `bridge serve` from Commander action arguments (blocks until the client disconnects). */
function handleServeAction(args: unknown[]): Promise<void> {
  const command = args.at(-1) as Command;
  return runServe(subcommandOpts(command));
}

/** Run `bridge login` from Commander action arguments. */
function handleLoginAction(args: unknown[], runner: CliRunner): void {
  const command = args.at(-1) as Command;
  void runner.runLogin(subcommandOpts(command));
}
