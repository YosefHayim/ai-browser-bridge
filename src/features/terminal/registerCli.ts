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
  runChatOrganizePause,
  runChatOrganizeResume,
  runChatOrganizeStatus,
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
  DesignCmdOptions,
  DownloadCmdOptions,
  FlowCmdOptions,
  ProjectCmdOptions,
  ServeOptions,
  TaskCmdOptions,
} from "./cliTypes.ts";
import {
  runDesignCatalog,
  runDesignCreate,
  runDesignDelete,
  runDesignDownload,
  runDesignDuplicate,
  runDesignExport,
  runDesignFavorite,
  runDesignFiles,
  runDesignModel,
  runDesignNewConversation,
  runDesignOpen,
  runDesignProjects,
  runDesignPut,
  runDesignRead,
  runDesignRemove,
  runDesignRename,
  runDesignRenameConversation,
  runDesignSend,
  runDesignShare,
  runDesignState,
  runDesignUseDesignSystems,
} from "./designCommands.ts";
import { subcommandOpts } from "./subcommandOpts.ts";

// Derived from PROVIDER_IDS so help text cannot go stale.
const PROVIDER_OPTION = `Browser provider: ${PROVIDER_IDS.join(", ")} (default: ${DEFAULT_PROVIDER})`;

export const registerCliCommands = (program: Command): void => {
  program
    .name("bridge")
    .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
    .version("0.7.0")
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
  registerDesignCommands(program);
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

const withOrganizationPacingFlags = (command: Command): Command => {
  return command
    .option(
      "--interval <secondsOrRange>",
      "Initial seconds between UI operations, fixed or random range such as 60-90 (default: 60)",
    )
    .option("--no-adaptive", "Keep the initial interval instead of adapting to success/limits")
    .option("--min-interval <seconds>", "Fastest adaptive base interval (default: 15)")
    .option("--max-interval <seconds>", "Slowest adaptive base interval (default: 180)")
    .option(
      "--speed-up-after <count>",
      "Successful moves before reducing the adaptive interval (default: 3)",
    )
    .option("--cooldown <seconds>", "Seconds to wait after rate limiting (default: 600)")
    .option("--max-attempts <count>", "Attempts per Conversation before failing (default: 4)")
    .option("--no-verify", "Skip the exhaustive orphan scan when the queue finishes");
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
  const organize = withOrganizationPacingFlags(withWorkspaceFlags(chat.command("organize")))
    .description("Run a resumable, rate-safe Conversation organization queue")
    .option(
      "--plan <fileOrJson>",
      "JSON array of {conversation, project} tasks (inline, @file, or a path)",
    )
    .option("--restart", "Restart this plan instead of resuming its persisted queue")
    .option("--dry-run", "Validate and show the queue without opening Chrome or writing state")
    .action((_options: ChatOrganizationOptions, command: Command) =>
      runChatOrganize(command.optsWithGlobals() as ChatOrganizationOptions),
    );
  withWorkspaceFlags(organize.command("status"))
    .description("Show the latest organization queue state and adaptive pace")
    .option("--queue <pathOrFingerprint>", "Select a queue instead of the latest one")
    .action((_options: ChatOrganizationOptions, command: Command) =>
      runChatOrganizeStatus(command.optsWithGlobals() as ChatOrganizationOptions),
    );
  withWorkspaceFlags(organize.command("pause"))
    .description("Pause the latest queue after its active UI operation")
    .option("--queue <pathOrFingerprint>", "Select a queue instead of the latest one")
    .action((_options: ChatOrganizationOptions, command: Command) =>
      runChatOrganizePause(command.optsWithGlobals() as ChatOrganizationOptions),
    );
  withOrganizationPacingFlags(withWorkspaceFlags(organize.command("resume")))
    .description("Resume the latest persisted organization queue")
    .option("--queue <pathOrFingerprint>", "Select a queue instead of the latest one")
    .action((_options: ChatOrganizationOptions, command: Command) =>
      runChatOrganizeResume(command.optsWithGlobals() as ChatOrganizationOptions),
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

const withBrowserCommandFlags = (command: Command): Command => {
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
  withBrowserCommandFlags(flow.command("clips"))
    .description("List clips in the current Flow project")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowClips(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("projects"))
    .description("List Flow projects")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowProjects(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("download"))
    .description("Download clip mp4s (all, or --id <clipId...>)")
    .option("--id <clipId...>", "Specific clip id(s); omit to download every clip")
    .option("--out <dir>", "Output directory (default: <repo>/.bridge/downloads/flow)")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowDownload(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("generate"))
    .description("Generate a Veo clip from a Start keyframe + prompt (image-to-video)")
    .option("--start <imagePath>", "Start keyframe image (image-to-video)")
    .option("--prompt <text>", "Shot / motion prompt")
    .option("--out <dir>", "Download directory (default: <repo>/.bridge/downloads/flow)")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowGenerate(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("delete"))
    .description("Move a clip to Flow Trash (recoverable)")
    .option("--id <clipId...>", "Clip id to trash")
    .option("-y, --yes", "Confirm the delete")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowDelete(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("rename"))
    .description("Rename a clip")
    .option("--id <clipId...>", "Clip id to rename")
    .option("--name <text>", "New clip name")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowRename(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("extend"))
    .description("Add a clip to a scene (Flow extend)")
    .option("--id <clipId...>", "Clip id to extend")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowExtend(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("reuse"))
    .description("Add a clip back to the prompt as input")
    .option("--id <clipId...>", "Clip id to reuse")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowReuse(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("project-rename"))
    .description("Rename the current Flow project")
    .option("--name <text>", "New project name")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowProjectRename(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("project-delete"))
    .description("Delete the current Flow project (permanent)")
    .option("-y, --yes", "Confirm the delete")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowProjectDelete(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("ingredients"))
    .description("List reference images attached to the current prompt")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowIngredients(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("ingredient-remove"))
    .description("Detach one prompt ingredient")
    .option("--id <mediaId...>", "Ingredient media id to remove")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowIngredientRemove(command.optsWithGlobals() as FlowCmdOptions),
    );
  withBrowserCommandFlags(flow.command("ingredient-clear"))
    .description("Detach every ingredient from the current prompt")
    .action((_options: FlowCmdOptions, command: Command) =>
      runFlowIngredientClear(command.optsWithGlobals() as FlowCmdOptions),
    );
};

const withDesignTurnFlags = (command: Command): Command => {
  return command
    .option("--model <label>", 'Model label or id, e.g. "Haiku 4.5" (More models included)')
    .option("--effort <level>", "Effort: Low, Medium, High, Extra, or Max")
    .option("--attach <path...>", "Local files to attach to the message")
    .option("--auto-decide", 'Answer Claude\'s clarifying questions with "Decide for me"')
    .option("--no-wait", "Return while the turn is still running")
    .option("--timeout <seconds>", "Max seconds to wait for the reply (default 600)");
};

const designCommand = (parent: Command, name: string, description: string): Command => {
  return withBrowserCommandFlags(parent.command(name)).description(description);
};

const designOptions = (command: Command): DesignCmdOptions =>
  command.optsWithGlobals() as DesignCmdOptions;

const registerDesignCommands = (program: Command): void => {
  const design = program
    .command("design")
    .description("Drive Claude Design projects, files, and Conversations (claude.ai/design)");
  designCommand(design, "state", "Show where Claude Design is and what can be done there").action(
    (_options: DesignCmdOptions, command: Command) => runDesignState(designOptions(command)),
  );
  designCommand(design, "projects", "List projects (or design systems)")
    .option("--query <text>", "Search by name")
    .option("--design-systems", "List design systems instead of projects")
    .option("--limit <n>", "Maximum rows (default 50)")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignProjects(designOptions(command)),
    );
  designCommand(
    design,
    "catalog",
    "List templates, models with effort levels, design systems",
  ).action((_options: DesignCmdOptions, command: Command) =>
    runDesignCatalog(designOptions(command)),
  );
  designCommand(design, "model", "Pick the model and effort (a project's composer, or home)")
    .option("--project <id>", "Project id (default: the home composer for new projects)")
    .option("--model <label>", 'Model label or id, e.g. "Sonnet 4.6" (More models included)')
    .option("--effort <level>", "Effort: Low, Medium, High, Extra, or Max")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignModel(designOptions(command)),
    );
  designCommand(design, "open", "Open (or focus) a project's tab")
    .option("--project <id>", "Project id")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignOpen(designOptions(command)),
    );
  withDesignTurnFlags(
    designCommand(design, "create", "Create a project — from a prompt (and template) or blank"),
  )
    .option("--name <text>", "Project name")
    .option("--prompt <text>", "First message; omit for a blank project")
    .option("--template <name>", "Home template, e.g. Slides (needs --prompt)")
    .option("--design-system <id...>", "Design systems for a blank project")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignCreate(designOptions(command)),
    );
  withDesignTurnFlags(designCommand(design, "send", "Send a message and print Claude's reply"))
    .option("--project <id>", "Project id")
    .option("--message <text>", "Message to send")
    .option("--conversation <id>", "Conversation to continue (default: the active one)")
    .option("--design-system <id...>", "Set the project's design systems first")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignSend(designOptions(command)),
    );
  designCommand(design, "read", "List Conversations and print the latest messages")
    .option("--project <id>", "Project id")
    .option("--conversation <id>", "Conversation (default: the active one)")
    .option("--limit <n>", "Most recent messages (default 20)")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignRead(designOptions(command)),
    );
  designCommand(design, "new-conversation", "Start a new Conversation in a project")
    .option("--project <id>", "Project id")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignNewConversation(designOptions(command)),
    );
  designCommand(design, "rename-conversation", "Rename a Conversation")
    .option("--project <id>", "Project id")
    .option("--conversation <id>", "Conversation id")
    .option("--title <text>", "New title")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignRenameConversation(designOptions(command)),
    );
  designCommand(design, "rename", "Rename a project")
    .option("--project <id>", "Project id")
    .option("--name <text>", "New name")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignRename(designOptions(command)),
    );
  designCommand(design, "duplicate", "Duplicate a project")
    .option("--project <id>", "Project id")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignDuplicate(designOptions(command)),
    );
  designCommand(design, "favorite", "Star a project (or --off to unstar)")
    .option("--project <id>", "Project id")
    .option("--off", "Remove the star")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignFavorite(designOptions(command)),
    );
  designCommand(design, "use-design-systems", "Set a project's design systems")
    .option("--project <id>", "Project id")
    .option("--design-system <id...>", "Design system project ids")
    .option("--none", "Clear the project's design systems")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignUseDesignSystems(designOptions(command)),
    );
  designCommand(design, "delete", "Delete a project (permanent)")
    .option("--project <id>", "Project id")
    .option("-y, --yes", "Confirm the delete")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignDelete(designOptions(command)),
    );
  designCommand(design, "files", "List a project's files")
    .option("--project <id>", "Project id")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignFiles(designOptions(command)),
    );
  designCommand(design, "put", "Add or replace project files from local files")
    .option("--project <id>", "Project id")
    .option("--file <path...>", "Local files to upload")
    .option("--dir <projectDir>", "Project folder to upload into (default: root)")
    .action((_options: DesignCmdOptions, command: Command) => runDesignPut(designOptions(command)));
  designCommand(design, "rm", "Delete project files")
    .option("--project <id>", "Project id")
    .option("--path <projectPath...>", "Project file paths")
    .option("-y, --yes", "Confirm the delete")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignRemove(designOptions(command)),
    );
  designCommand(design, "download", "Download project files")
    .option("--project <id>", "Project id")
    .option("--path <projectPath...>", "Files to download (default: all)")
    .option("--out <dir>", "Output folder (default: <repo>/.bridge/downloads/design/<id>)")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignDownload(designOptions(command)),
    );
  designCommand(design, "export", "Download the project as a zip")
    .option("--project <id>", "Project id")
    .option("--out <dir>", "Output folder (default: <repo>/.bridge/downloads/design/<id>)")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignExport(designOptions(command)),
    );
  designCommand(design, "share", "Set who can open a project and print its link")
    .option("--project <id>", "Project id")
    .option("--access <who>", "private or workspace")
    .option("--permission <level>", "view, comment, or edit")
    .action((_options: DesignCmdOptions, command: Command) =>
      runDesignShare(designOptions(command)),
    );
};
