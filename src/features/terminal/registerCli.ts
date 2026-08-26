import type { Command } from "commander";
import { DEFAULT_ASK_TIMEOUT_SECONDS, DEFAULT_PROVIDER, PROVIDER_IDS } from "@/config";
import {
  runAsk,
  runBrowserStatus,
  runCacheList,
  runCachePrune,
  runChatArchive,
  runChatgptInspect,
  runChatList,
  runChatMove,
  runChatOrganize,
  runChatSearch,
  runChromeStart,
  runDownload,
  runFlowClips,
  runFlowDelete,
  runFlowDownload,
  runFlowExtend,
  runFlowGenerate,
  runFlowIngredientClear,
  runFlowIngredientRemove,
  runFlowIngredients,
  runFlowProjectDelete,
  runFlowProjectRename,
  runFlowProjects,
  runFlowRename,
  runFlowReuse,
  runInteractiveCli,
  runProjectCreate,
  runProjectDelete,
  runProjectList,
  runProjectRename,
  runServe,
  runSessions,
  runStop,
  runTaskCreate,
  runTaskList,
} from "./cliOperations.ts";
import type {
  AskOptions,
  BrowserStatusOptions,
  CacheCmdOptions,
  ChatCmdOptions,
  ChatgptCmdOptions,
  ChatOrganizationOptions,
  ChromeStartOptions,
  CliOptions,
  DownloadCmdOptions,
  FlowCmdOptions,
  ProjectCmdOptions,
  ServeOptions,
  TaskCmdOptions,
} from "./cliTypes.ts";
import { subcommandOpts } from "./subcommandOpts.ts";

// Derived from PROVIDER_IDS so help text cannot go stale.
const PROVIDER_OPTION = `Browser provider: ${PROVIDER_IDS.join(", ")} (default: ${DEFAULT_PROVIDER})`;

export const registerCliCommands = (program: Command): void => {
  program
    .name("bridge")
    .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
    .version("0.5.0")
    .option("-r, --repo <path>", "Path to the target repository (default: cwd)")
    .option("-p, --port <number>", "MCP server port (default: 8765)")
    .option("--provider <name>", PROVIDER_OPTION)
    .option("--no-browser", "Skip Chrome browser connection")
    .action(async (_options: CliOptions, command: Command) => {
      if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        command.outputHelp({ error: true });
        process.exitCode = 1;
        return;
      }
      await runInteractiveCli(command.opts() as CliOptions & { browser?: boolean });
    });
  registerHeadlessCommands(program);
  registerWorkspaceCommands(program);
  registerChatgptCommands(program);
  registerFlowCommands(program);
};

const registerChatgptCommands = (program: Command): void => {
  const chatgpt = program
    .command("chatgpt")
    .description("Inspect the live ChatGPT render (ChatGPT only)");
  chatgpt
    .command("inspect")
    .description("Print the current ChatGPT render state (streaming, image progress, limits)")
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option("-p, --port <number>", "MCP server port")
    .option("--all-tabs", "Report every ChatGPT tab in the browser instead of just the active one")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((_options: ChatgptCmdOptions, command: Command) =>
      runChatgptInspect(command.optsWithGlobals() as ChatgptCmdOptions),
    );
};

const registerHeadlessCommands = (program: Command): void => {
  program
    .command("ask [prompt...]")
    .description("Send one prompt and print the reply, or fan out several with --fan-out")
    .option("-r, --repo <path>", "Target repository for MCP tools")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <names>", `${PROVIDER_OPTION}; comma-separated for fan-out`)
    .option("--strict", "Fan-out: exit non-zero if any task fails (default: only if all fail)")
    .option(
      "--json",
      "Emit a JSON object { sessionId, model, reply, contextTokens } (or the fan-out result)",
    )
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
    .option(
      "--fan-out <fileOrJson>",
      "Fan out several Conversations at once: a JSON array of {prompt,provider?,conversation?,label?,isolate?} (inline, @file, or a path)",
    )
    .option("--max-concurrency <n>", "Fan-out: max Conversations in flight at once (default 1)")
    .option("--limit <n>", "Fan-out: max tasks to run and return per call (default 20)")
    .option("--offset <n>", "Fan-out: skip this many tasks before running (pagination)")
    .option(
      "--max-reply-chars <n>",
      "Fan-out: truncate each reply to this many characters (default 2000)",
    )
    .option(
      "--debug-port <number>",
      "Chrome remote-debugging port to drive (parallel accounts; default 9222)",
    )
    .option(
      "--profile <path>",
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .action((promptParts: string[], _options: AskOptions, command: Command) =>
      runAsk(promptParts.join(" "), subcommandOpts(command)),
    );
  program
    .command("download")
    .description("Download a conversation's attachments/images (non-interactive, ChatGPT only)")
    .option("-r, --repo <path>", "Target repository")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", PROVIDER_OPTION)
    .option("--conversation <id>", "Conversation id (default: current page)")
    .option("--out <dir>", "Output directory (default: <repo>/.bridge/downloads/<id>)")
    .option("--id <attachmentId...>", "Specific attachment id(s); omit to download all")
    .option("--scan", "Rescan conversation attachments into manifest without downloading")
    .option("--json", "Emit a JSON array of results")
    .option(
      "--debug-port <number>",
      "Chrome remote-debugging port to drive (parallel accounts; default 9222)",
    )
    .option(
      "--profile <path>",
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .action((_options: DownloadCmdOptions, command: Command) =>
      runDownload(subcommandOpts(command)),
    );
  program
    .command("sessions")
    .description("List stored bridge sessions as JSON")
    .action(() => runSessions());
  program
    .command("status")
    .description("Show browser/debug-port status")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((_options: BrowserStatusOptions, command: Command) =>
      runBrowserStatus(command.optsWithGlobals() as BrowserStatusOptions),
    );
  registerChromeCommands(program);
  registerCacheCommands(program);
  program
    .command("stop")
    .description("Close the warm bridge browser")
    .action(() => runStop());
  program
    .command("serve")
    .description("Serve the outbound MCP `ask` tool over stdio so other agents can drive web chats")
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option(
      "--timeout <seconds>",
      "Default per-provider reply timeout when an `ask` caller omits one",
    )
    .action((_options: ServeOptions, command: Command) => runServe(subcommandOpts(command)));
};

const registerChromeCommands = (program: Command): void => {
  const chrome = program.command("chrome").description("Manage the local Chrome debug session");
  chrome
    .command("start")
    .description("Start the shared bridge profile with the bridge debug port")
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option("--provider <name>", PROVIDER_OPTION)
    .option(
      "--debug-port <number>",
      "Chrome remote-debugging port to spawn on (parallel accounts; default 9222)",
    )
    .option(
      "--profile <path>",
      "Chrome user-data-dir to spawn (parallel accounts; default shared bridge profile)",
    )
    .action((_options: ChromeStartOptions, command: Command) =>
      runChromeStart(command.optsWithGlobals() as ChromeStartOptions),
    );
  chrome
    .command("status")
    .description("Show Chrome/debug-port status")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((_options: BrowserStatusOptions, command: Command) =>
      runBrowserStatus(command.optsWithGlobals() as BrowserStatusOptions),
    );
  chrome
    .command("stop")
    .description("Close the Chrome debug-port process")
    .action(() => runStop());
};

const registerCacheCommands = (program: Command): void => {
  const cache = program.command("cache").description("Inspect or prune generated Chrome cache");
  cache
    .command("list")
    .description("List generated Chrome cache paths safe for bridge cleanup")
    .option("--profile <path>", "Chrome profile root (default: shared bridge profile)")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((_options: CacheCmdOptions, command: Command) =>
      runCacheList(command.optsWithGlobals() as CacheCmdOptions),
    );
  cache
    .command("prune")
    .description("Prune generated Chrome cache paths; identity data is never targeted")
    .option("--profile <path>", "Chrome profile root (default: shared bridge profile)")
    .option("--dry-run", "Preview deletions without removing files")
    .option("-y, --yes", "Confirm deletion")
    .option("--json", "Emit JSON instead of human-readable lines")
    .action((_options: CacheCmdOptions, command: Command) =>
      runCachePrune(command.optsWithGlobals() as CacheCmdOptions),
    );
};

const withWorkspaceFlags = (command: Command): Command => {
  return command
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option("-p, --port <number>", "MCP server port")
    .option("--provider <name>", PROVIDER_OPTION)
    .option(
      "--debug-port <number>",
      "Chrome remote-debugging port to drive (parallel accounts; default 9222)",
    )
    .option(
      "--profile <path>",
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .option("--json", "Emit JSON instead of human-readable lines");
};

const registerWorkspaceCommands = (program: Command): void => {
  const project = program.command("project").description("Manage ChatGPT Projects (ChatGPT only)");
  withWorkspaceFlags(project.command("list"))
    .description("List ChatGPT Projects")
    .action((_options: ProjectCmdOptions, command: Command) =>
      runProjectList(command.optsWithGlobals() as ProjectCmdOptions),
    );
  withWorkspaceFlags(project.command("create <name...>"))
    .description("Create a ChatGPT Project")
    .option("--instructions <text>", "Optional project instructions")
    .action((nameParts: string[], _options: ProjectCmdOptions, command: Command) =>
      runProjectCreate(nameParts.join(" "), command.optsWithGlobals() as ProjectCmdOptions),
    );
  withWorkspaceFlags(project.command("rename <name...>"))
    .description("Rename a ChatGPT Project")
    .option("--to <newName>", "New project name")
    .action((nameParts: string[], _options: ProjectCmdOptions, command: Command) =>
      runProjectRename(nameParts.join(" "), command.optsWithGlobals() as ProjectCmdOptions),
    );
  withWorkspaceFlags(project.command("delete <name...>"))
    .description("Delete a ChatGPT Project (permanently deletes its chats)")
    .option("-y, --yes", "Confirm deletion")
    .action((nameParts: string[], _options: ProjectCmdOptions, command: Command) =>
      runProjectDelete(nameParts.join(" "), command.optsWithGlobals() as ProjectCmdOptions),
    );

  const chat = program
    .command("chat")
    .description("List or organize ChatGPT conversations (ChatGPT only)");
  withWorkspaceFlags(chat.command("list"))
    .description("List sidebar (project-less) conversations")
    .option("--orphans", "List only loose, project-less conversations")
    .action((_options: ChatCmdOptions, command: Command) =>
      runChatList(command.optsWithGlobals() as ChatCmdOptions),
    );
  withWorkspaceFlags(chat.command("search <query...>"))
    .description("Search ChatGPT conversation history")
    .option("--limit <count>", "Maximum results (default: 20)")
    .option("--open", "Open the best match in the browser")
    .action((queryParts: string[], _options: ChatCmdOptions, command: Command) =>
      runChatSearch(queryParts.join(" "), command.optsWithGlobals() as ChatCmdOptions),
    );
  withWorkspaceFlags(chat.command("move [idOrTitle...]"))
    .description("Move one or more conversations into a Project")
    .option("--project <name>", "Destination project name")
    .option("--id <id...>", "Move several conversations by id in one session")
    .action((chatParts: string[], _options: ChatCmdOptions, command: Command) =>
      runChatMove(chatParts.join(" "), command.optsWithGlobals() as ChatCmdOptions),
    );
  withWorkspaceFlags(chat.command("archive [idOrTitle...]"))
    .description("Archive one or more conversations (reversible — hides from the sidebar)")
    .option("--id <id...>", "Archive several conversations by id in one session")
    .action((chatParts: string[], _options: ChatCmdOptions, command: Command) =>
      runChatArchive(chatParts.join(" "), command.optsWithGlobals() as ChatCmdOptions),
    );
  withWorkspaceFlags(chat.command("organize"))
    .description("Run a resumable, rate-safe Conversation organization queue")
    .requiredOption(
      "--plan <fileOrJson>",
      "JSON array of {conversation, project} tasks (inline, @file, or a path)",
    )
    .option(
      "--interval <secondsOrRange>",
      "Seconds between UI operations, fixed or random range such as 10-20 (default: 30)",
    )
    .option("--cooldown <seconds>", "Seconds to wait after rate limiting (default: 300)")
    .option("--max-attempts <count>", "Attempts per Conversation before failing (default: 3)")
    .option("--restart", "Restart this plan instead of resuming its persisted queue")
    .option("--dry-run", "Validate and show the queue without opening Chrome or writing state")
    .action((_options: ChatOrganizationOptions, command: Command) =>
      runChatOrganize(command.optsWithGlobals() as ChatOrganizationOptions),
    );

  const task = program.command("task").description("List or schedule ChatGPT Tasks (ChatGPT only)");
  withWorkspaceFlags(task.command("list"))
    .description("List ChatGPT Scheduled tasks")
    .action((_options: TaskCmdOptions, command: Command) =>
      runTaskList(command.optsWithGlobals() as TaskCmdOptions),
    );
  withWorkspaceFlags(task.command("create <prompt...>"))
    .description("Schedule a task via natural language")
    .option("--every <spec>", "Recurring cadence (e.g. day, or weekday at 9am)")
    .option("--at <spec>", "One-off run time (e.g. tomorrow at 9am)")
    .action((promptParts: string[], _options: TaskCmdOptions, command: Command) =>
      runTaskCreate(promptParts.join(" "), command.optsWithGlobals() as TaskCmdOptions),
    );
};

const withFlowFlags = (command: Command): Command => {
  return command
    .option("-r, --repo <path>", "Target repository for bridge state")
    .option("-p, --port <number>", "MCP server port")
    .option(
      "--debug-port <number>",
      "Chrome remote-debugging port to drive (parallel accounts; default 9222)",
    )
    .option(
      "--profile <path>",
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .option("--json", "Emit JSON instead of human-readable lines");
};

const registerFlowCommands = (program: Command): void => {
  const flow = program
    .command("flow")
    .description("Manage Google Flow clips, ingredients & projects (Flow only)");
  withFlowFlags(flow.command("clips"))
    .description("List clips in the current Flow project")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowClips(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("projects"))
    .description("List Flow projects")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowProjects(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("download"))
    .description("Download clip mp4s (all, or --id <clipId...>)")
    .option("--id <clipId...>", "Specific clip id(s); omit to download every clip")
    .option("--out <dir>", "Output directory (default: <repo>/.bridge/downloads/flow)")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowDownload(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("generate"))
    .description("Generate a Veo clip from a Start keyframe + prompt (image-to-video)")
    .option("--start <imagePath>", "Start keyframe image (image-to-video)")
    .option("--prompt <text>", "Shot / motion prompt")
    .option("--out <dir>", "Download directory (default: <repo>/.bridge/downloads/flow)")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowGenerate(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("delete"))
    .description("Move a clip to Flow Trash (recoverable)")
    .option("--id <clipId...>", "Clip id to trash")
    .option("-y, --yes", "Confirm the delete")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowDelete(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("rename"))
    .description("Rename a clip")
    .option("--id <clipId...>", "Clip id to rename")
    .option("--name <text>", "New clip name")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowRename(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("extend"))
    .description("Add a clip to a scene (Flow extend)")
    .option("--id <clipId...>", "Clip id to extend")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowExtend(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("reuse"))
    .description("Add a clip back to the prompt as input")
    .option("--id <clipId...>", "Clip id to reuse")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowReuse(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("project-rename"))
    .description("Rename the current Flow project")
    .option("--name <text>", "New project name")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowProjectRename(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("project-delete"))
    .description("Delete the current Flow project (permanent)")
    .option("-y, --yes", "Confirm the delete")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowProjectDelete(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("ingredients"))
    .description("List reference images attached to the current prompt")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowIngredients(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("ingredient-remove"))
    .description("Detach one prompt ingredient")
    .option("--id <mediaId...>", "Ingredient media id to remove")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowIngredientRemove(command.optsWithGlobals() as FlowCmdOptions),
    );
  withFlowFlags(flow.command("ingredient-clear"))
    .description("Detach every ingredient from the current prompt")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowIngredientClear(command.optsWithGlobals() as FlowCmdOptions),
    );
};
