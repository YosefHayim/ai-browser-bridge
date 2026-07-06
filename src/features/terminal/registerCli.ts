import { DEFAULT_ASK_TIMEOUT_SECONDS } from "@/config";
import { DEFAULT_PROVIDER, PROVIDER_IDS } from "@/features/providers";
import type { Command } from "commander";
import type {
  BrowserStatusOptions,
  CacheCmdOptions,
  ChatCmdOptions,
  ProjectCmdOptions,
  TaskCmdOptions,
} from "./cliTypes.ts";
import {
  CliRunner,
  runBrowserStatus,
  runCacheList,
  runCachePrune,
  runChatList,
  runChatMove,
  runChatSearch,
  runChromeStart,
  runDownload,
  runProjectCreate,
  runProjectList,
  runServe,
  runStop,
  runTaskCreate,
  runTaskList,
} from "./internal/cliRunner.ts";
import { subcommandOpts } from "./subcommandOpts.ts";

/** `--provider` help text, derived from the registry so it never goes stale. */
const PROVIDER_OPTION = `Browser provider: ${PROVIDER_IDS.join(", ")} (default: ${DEFAULT_PROVIDER})`;

/**
 * Register all bridge CLI commands on a Commander program.
 *
 * @param program - Program value.
 * @param runner - Runner value.
 * @returns Completes when `registerCliCommands` finishes.
 * @example
 * ```ts
 * registerCliCommands(program, runner);
 * ```
 */
export const registerCliCommands = (program: Command, runner = new CliRunner()): void => {
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
};

/** Register non-interactive headless subcommands. */
const registerHeadlessCommands = (program: Command, runner: CliRunner): void => {
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
    .command("status")
    .description("Show browser/debug-port status")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((...args: unknown[]) => handleBrowserStatusAction(args));
  registerChromeCommands(program);
  registerCacheCommands(program);
  program
    .command("stop")
    .description("Close the warm bridge browser")
    .action(() => runner.runStop());
  program
    .command("serve")
    .description("Serve the outbound MCP `ask` tool over stdio so other agents can drive web chats")
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option(
      "--timeout <seconds>",
      "Default per-provider reply timeout when an `ask` caller omits one",
    )
    .action((...args: unknown[]) => handleServeAction(args));
};

/** Register direct Chrome lifecycle commands. */
const registerChromeCommands = (program: Command): void => {
  const chrome = program.command("chrome").description("Manage the local Chrome debug session");
  chrome
    .command("start")
    .description("Start the existing Chrome profile with the bridge debug port")
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option("--provider <name>", PROVIDER_OPTION)
    .action((...args: unknown[]) => handleChromeStartAction(args));
  chrome
    .command("status")
    .description("Show Chrome/debug-port status")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((...args: unknown[]) => handleBrowserStatusAction(args));
  chrome
    .command("stop")
    .description("Close the Chrome debug-port process")
    .action(() => void runStop());
};

/** Register Chrome generated-cache commands. */
const registerCacheCommands = (program: Command): void => {
  const cache = program.command("cache").description("Inspect or prune generated Chrome cache");
  cache
    .command("list")
    .description("List generated Chrome cache paths safe for bridge cleanup")
    .option("--profile <path>", "Chrome profile root (default: normal Google Chrome profile)")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((...args: unknown[]) => handleCacheListAction(args));
  cache
    .command("prune")
    .description("Prune generated Chrome cache paths; identity data is never targeted")
    .option("--profile <path>", "Chrome profile root (default: normal Google Chrome profile)")
    .option("--dry-run", "Preview deletions without removing files")
    .option("-y, --yes", "Confirm deletion")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((...args: unknown[]) => handleCachePruneAction(args));
};

/** Attach the shared repo/port/provider/json flags to a workspace leaf command. */
const withWorkspaceFlags = (command: Command): Command => {
  return command
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", PROVIDER_OPTION)
    .option("--json", "Emit JSON instead of human-readable lines");
};

/** Register `project`, `chat`, and `task` workspace subcommands (ChatGPT only). */
const registerWorkspaceCommands = (program: Command): void => {
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
  withWorkspaceFlags(chat.command("search <query...>"))
    .description("Search ChatGPT conversation history")
    .option("--limit <count>", "Maximum results (default: 20)")
    .option("--open", "Open the best match in the browser")
    .action((...args: unknown[]) => handleWorkspaceArg<ChatCmdOptions>(args, runChatSearch));
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
};

/** Run a no-positional workspace verb from Commander action arguments. */
const handleWorkspace = <T extends object>(
  args: unknown[],
  run: (options: T) => Promise<void>,
): void => {
  const command = args.at(-1) as Command;
  void run(command.optsWithGlobals() as T);
};

/** Run a variadic-positional workspace verb (name/title/prompt) from Commander action arguments. */
const handleWorkspaceArg = <T extends object>(
  args: unknown[],
  run: (value: string, options: T) => Promise<void>,
): void => {
  const command = args.at(-1) as Command;
  const parts = (args[0] ?? []) as string[];
  void run(parts.join(" "), command.optsWithGlobals() as T);
};

/** Run default `bridge` TUI from Commander action arguments. */
const handleDefaultAction = (args: unknown[], runner: CliRunner): void => {
  const command = args.at(-1) as Command;
  void runner.runDefault(command.opts());
};

/**
 * Run `bridge ask` from Commander action arguments.
 *
 * For a variadic `<prompt...>`, Commander calls the action with
 * `(promptParts, options, command)` — the prompt words are the first argument,
 * not every argument before the command. Joining `args.slice(0, -1)` instead
 * swept the options object into the prompt, appending a literal `[object
 * Object]` to whatever the user asked.
 */
const handleAskAction = (args: unknown[], runner: CliRunner): void => {
  const command = args.at(-1) as Command;
  const promptParts = (args[0] ?? []) as string[];
  void runner.runAsk(promptParts.join(" "), subcommandOpts(command));
};

/** Run `bridge download` from Commander action arguments. */
const handleDownloadAction = (args: unknown[]): void => {
  const command = args.at(-1) as Command;
  void runDownload(subcommandOpts(command));
};

/** Run `bridge serve` from Commander action arguments (blocks until the client disconnects). */
const handleServeAction = (args: unknown[]): Promise<void> => {
  const command = args.at(-1) as Command;
  return runServe(subcommandOpts(command));
};

/** Run `bridge status` / `bridge chrome status` from Commander action arguments. */
const handleBrowserStatusAction = (args: unknown[]): void => {
  const command = args.at(-1) as Command;
  void runBrowserStatus(command.optsWithGlobals() as BrowserStatusOptions);
};

/** Run `bridge chrome start` from Commander action arguments. */
const handleChromeStartAction = (args: unknown[]): void => {
  const command = args.at(-1) as Command;
  void runChromeStart(command.optsWithGlobals());
};

/** Run `bridge cache list` from Commander action arguments. */
const handleCacheListAction = (args: unknown[]): void => {
  const command = args.at(-1) as Command;
  void runCacheList(command.optsWithGlobals() as CacheCmdOptions);
};

/** Run `bridge cache prune` from Commander action arguments. */
const handleCachePruneAction = (args: unknown[]): void => {
  const command = args.at(-1) as Command;
  void runCachePrune(command.optsWithGlobals() as CacheCmdOptions);
};
