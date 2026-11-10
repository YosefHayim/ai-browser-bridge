import type { Command } from "commander";
import packageJson from "@/../package.json" with { type: "json" };
import { DEFAULT_ASK_TIMEOUT_SECONDS, DEFAULT_PROVIDER, PROVIDER_IDS } from "@/config";
import { createUsageError } from "./cli-failure.ts";
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
  runChatRename,
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
} from "./cli-operations.ts";
import type {
  AskSettings,
  BrowserStatusSettings,
  CacheCommandSettings,
  ChatCommandSettings,
  ChatgptCommandSettings,
  ChatOrganizationSettings,
  ChromeStartSettings,
  CliSettings,
  DesignCommandSettings,
  DownloadCommandSettings,
  FlowCommandSettings,
  ProjectCommandSettings,
  ServeSettings,
  TaskCommandSettings,
} from "./cli-types.ts";
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
  runDesignStatus,
  runDesignUseDesignSystems,
} from "./design-commands.ts";
import { readSubcommandSettings } from "./subcommand-opts.ts";

const STOP_COMMAND_NAME = "stop";
const STATUS_COMMAND_NAME = "status";
const RENAME_COMMAND_NAME = "rename";
const PROJECTS_COMMAND_NAME = "projects";
const LIST_COMMAND_NAME = "list";
const DOWNLOAD_COMMAND_NAME = "download";
const DELETE_COMMAND_NAME = "delete";
const OUT_DESCRIPTION = "Output folder (default: <repo>/.bridge/downloads/design/<id>)";
const QUEUE_DESCRIPTION = "Select a queue instead of the latest one";
const EFFORT_DESCRIPTION = "Effort: Low, Medium, High, Extra, or Max";
const MCP_PORT_DESCRIPTION = "MCP server port";
const DEBUG_PORT_DESCRIPTION =
  "Chrome remote-debugging port to drive (parallel accounts; default 9222)";
const REPO_DESCRIPTION = "Target repository for bridge state";
const MACHINE_READABLE_DESCRIPTION = "Emit JSON instead of human-readable lines";
const PROJECT_ID_DESCRIPTION = "Project id";
const PROMPT_OPTION = "--prompt <text>";
const PROJECT_PATH_OPTION = "--path <projectPath...>";
const MODEL_OPTION = "--model <label>";
const EFFORT_OPTION = "--effort <level>";
const DRY_RUN_OPTION = "--dry-run";
const ATTACH_OPTION = "--attach <path...>";
const DESIGN_SYSTEM_OPTION = "--design-system <id...>";
const QUEUE_OPTION = "--queue <pathOrFingerprint>";
const ID_OPTION = "--id <id...>";
const LIMIT_OPTION = "--limit <n>";
const TIMEOUT_OPTION = "--timeout <seconds>";
const PROVIDER_FLAG = "--provider <name>";
const CONVERSATION_OPTION = "--conversation <id>";
const NAME_OPTION = "--name <text>";
const OUT_OPTION = "--out <dir>";
const CLIP_ID_OPTION = "--id <clipId...>";
const YES_OPTION = "-y, --yes";
const DEBUG_PORT_OPTION = "--debug-port <number>";
const PORT_OPTION = "-p, --port <number>";
const REPO_OPTION = "-r, --repo <path>";
const PROFILE_OPTION = "--profile <path>";
const MACHINE_READABLE_FLAG = "--json";
const PROJECT_ID_OPTION = "--project <id>";
const SPACE = " ";

// Derived from PROVIDER_IDS so help text cannot go stale.
const PROVIDER_OPTION = `Browser provider: ${PROVIDER_IDS.join(", ")} (default: ${DEFAULT_PROVIDER})`;

export const registerCliCommands = (program: Command): void => {
  program
    .name("bridge")
    .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
    .version(packageJson.version)
    .option(REPO_OPTION, "Path to the target repository (default: cwd)")
    .option(PORT_OPTION, "MCP server port (default: 8765)")
    .option(PROVIDER_FLAG, PROVIDER_OPTION)
    .option("--no-browser", "Skip Chrome browser connection")
    .action(async (_settings: CliSettings, command: Command) => {
      const isThereNoTerminal = process.stdin.isTTY !== true || process.stdout.isTTY !== true;
      if (isThereNoTerminal) {
        command.outputHelp({ error: true });
        throw createUsageError(
          "bridge: the interactive mode needs a terminal. Use `bridge ask <prompt>` for piped use.",
        );
      }

      await runInteractiveCli(command.opts() as CliSettings & { browser?: boolean });
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
    .option(REPO_OPTION, REPO_DESCRIPTION)
    .option(PORT_OPTION, MCP_PORT_DESCRIPTION)
    .option("--all-tabs", "Report every ChatGPT tab in the browser instead of just the active one")
    .option(DEBUG_PORT_OPTION, DEBUG_PORT_DESCRIPTION)
    .option(
      PROFILE_OPTION,
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION)
    .action((_settings: ChatgptCommandSettings, command: Command) =>
      runChatgptInspect(command.optsWithGlobals() as ChatgptCommandSettings),
    );
};

const registerHeadlessCommands = (program: Command): void => {
  program
    .command("ask [prompt...]")
    .description("Send one prompt and print the reply, or fan out several with --fan-out")
    .option(REPO_OPTION, "Target repository for MCP tools")
    .option(PORT_OPTION, MCP_PORT_DESCRIPTION)
    .option("--provider <names>", `${PROVIDER_OPTION}; comma-separated for fan-out`)
    .option("--strict", "Fan-out: exit non-zero if any task fails (default: only if all fail)")
    .option(
      MACHINE_READABLE_FLAG,
      "Emit a JSON object { sessionId, model, reply, contextTokens, conversationId, url } (or the fan-out result)",
    )
    .option(
      "--tools",
      "Start the tunnel + connector so ChatGPT can call local tools (ChatGPT only)",
    )
    .option("--fresh", "Start a new conversation before asking")
    .option("--conversation <idOrUrl>", "Open a ChatGPT conversation by id or URL before asking")
    .option("--model <name>", "Switch model before asking")
    .option(
      TIMEOUT_OPTION,
      `Max seconds to wait for the reply (default ${DEFAULT_ASK_TIMEOUT_SECONDS})`,
    )
    .option(ATTACH_OPTION, "Attach repo-relative image file(s) before asking")
    .option(
      "--images <count>",
      "Wait for ChatGPT to finish generating this many images before returning",
    )
    .option(
      "--fan-out <fileOrJson>",
      "Fan out several Conversations at once: a JSON array of {prompt,provider?,conversation?,label?,isolate?} (inline, @file, or a path)",
    )
    .option("--max-concurrency <n>", "Fan-out: max Conversations in flight at once (default 1)")
    .option(LIMIT_OPTION, "Fan-out: max tasks to run and return per call (default 20)")
    .option("--offset <n>", "Fan-out: skip this many tasks before running (pagination)")
    .option(
      "--max-reply-chars <n>",
      "Fan-out: truncate each reply to this many characters (default 2000)",
    )
    .option(DEBUG_PORT_OPTION, DEBUG_PORT_DESCRIPTION)
    .option(
      PROFILE_OPTION,
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .action((promptParts: string[], _settings: AskSettings, command: Command) =>
      runAsk(promptParts.join(SPACE), readSubcommandSettings(command)),
    );
  program
    .command(DOWNLOAD_COMMAND_NAME)
    .description("Download a conversation's attachments/images (non-interactive, ChatGPT only)")
    .option(REPO_OPTION, "Target repository")
    .option(PORT_OPTION, MCP_PORT_DESCRIPTION)
    .option(PROVIDER_FLAG, PROVIDER_OPTION)
    .option(CONVERSATION_OPTION, "Conversation id (default: current page)")
    .option(OUT_OPTION, "Output directory (default: <repo>/.bridge/downloads/<id>)")
    .option("--id <attachmentId...>", "Specific attachment id(s); omit to download all")
    .option("--scan", "Rescan conversation attachments into manifest without downloading")
    .option(MACHINE_READABLE_FLAG, "Emit a JSON array of results")
    .option(DEBUG_PORT_OPTION, DEBUG_PORT_DESCRIPTION)
    .option(
      PROFILE_OPTION,
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .action((_settings: DownloadCommandSettings, command: Command) =>
      runDownload(readSubcommandSettings(command)),
    );
  program
    .command("sessions")
    .description("List stored bridge sessions as JSON")
    .action(() => runSessions());
  program
    .command(STATUS_COMMAND_NAME)
    .description("Show browser/debug-port status")
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION)
    .action((_settings: BrowserStatusSettings, command: Command) =>
      runBrowserStatus(command.optsWithGlobals() as BrowserStatusSettings),
    );
  registerChromeCommands(program);
  registerCacheCommands(program);
  program
    .command(STOP_COMMAND_NAME)
    .description("Close the warm bridge browser")
    .action(() => runStop());
  program
    .command("serve")
    .description("Serve the outbound MCP `ask` tool over stdio so other agents can drive web chats")
    .option(REPO_OPTION, REPO_DESCRIPTION)
    .option(TIMEOUT_OPTION, "Default per-provider reply timeout when an `ask` caller omits one")
    .action((_settings: ServeSettings, command: Command) =>
      runServe(readSubcommandSettings(command)),
    );
};

const registerChromeCommands = (program: Command): void => {
  const chrome = program.command("chrome").description("Manage the local Chrome debug session");

  chrome
    .command("start")
    .description("Start the shared bridge profile with the bridge debug port")
    .option(REPO_OPTION, REPO_DESCRIPTION)
    .option(PROVIDER_FLAG, PROVIDER_OPTION)
    .option(
      DEBUG_PORT_OPTION,
      "Chrome remote-debugging port to spawn on (parallel accounts; default 9222)",
    )
    .option(
      PROFILE_OPTION,
      "Chrome user-data-dir to spawn (parallel accounts; default shared bridge profile)",
    )
    .action((_settings: ChromeStartSettings, command: Command) =>
      runChromeStart(command.optsWithGlobals() as ChromeStartSettings),
    );
  chrome
    .command(STATUS_COMMAND_NAME)
    .description("Show Chrome/debug-port status")
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION)
    .action((_settings: BrowserStatusSettings, command: Command) =>
      runBrowserStatus(command.optsWithGlobals() as BrowserStatusSettings),
    );
  chrome
    .command(STOP_COMMAND_NAME)
    .description("Close the Chrome debug-port process")
    .action(() => runStop());
};

const registerCacheCommands = (program: Command): void => {
  const cache = program.command("cache").description("Inspect or prune generated Chrome cache");

  cache
    .command(LIST_COMMAND_NAME)
    .description("List generated Chrome cache paths safe for bridge cleanup")
    .option(PROFILE_OPTION, "Chrome profile root (default: shared bridge profile)")
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION)
    .action((_settings: CacheCommandSettings, command: Command) =>
      runCacheList(command.optsWithGlobals() as CacheCommandSettings),
    );
  cache
    .command("prune")
    .description("Prune generated Chrome cache paths; identity data is never targeted")
    .option(PROFILE_OPTION, "Chrome profile root (default: shared bridge profile)")
    .option(DRY_RUN_OPTION, "Preview deletions without removing files")
    .option(YES_OPTION, "Confirm deletion")
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION)
    .action((_settings: CacheCommandSettings, command: Command) =>
      runCachePrune(command.optsWithGlobals() as CacheCommandSettings),
    );
};

const addWorkspaceFlags = (command: Command): Command => {
  return command
    .option(REPO_OPTION, REPO_DESCRIPTION)
    .option(PORT_OPTION, MCP_PORT_DESCRIPTION)
    .option(PROVIDER_FLAG, PROVIDER_OPTION)
    .option(DEBUG_PORT_OPTION, DEBUG_PORT_DESCRIPTION)
    .option(
      PROFILE_OPTION,
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION);
};

const addOrganizationPacingFlags = (command: Command): Command => {
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
  addWorkspaceFlags(project.command(LIST_COMMAND_NAME))
    .description("List ChatGPT Projects")
    .action((_settings: ProjectCommandSettings, command: Command) =>
      runProjectList(command.optsWithGlobals() as ProjectCommandSettings),
    );
  addWorkspaceFlags(project.command("create <name...>"))
    .description("Create a ChatGPT Project")
    .option("--instructions <text>", "Optional project instructions")
    .action((nameParts: string[], _settings: ProjectCommandSettings, command: Command) =>
      runProjectCreate(nameParts.join(SPACE), command.optsWithGlobals() as ProjectCommandSettings),
    );
  addWorkspaceFlags(project.command("rename <name...>"))
    .description("Rename a ChatGPT Project")
    .option("--to <newName>", "New project name")
    .action((nameParts: string[], _settings: ProjectCommandSettings, command: Command) =>
      runProjectRename(nameParts.join(SPACE), command.optsWithGlobals() as ProjectCommandSettings),
    );
  addWorkspaceFlags(project.command("delete <name...>"))
    .description("Delete a ChatGPT Project (permanently deletes its chats)")
    .option(YES_OPTION, "Confirm deletion")
    .action((nameParts: string[], _settings: ProjectCommandSettings, command: Command) =>
      runProjectDelete(nameParts.join(SPACE), command.optsWithGlobals() as ProjectCommandSettings),
    );

  const chat = program
    .command("chat")
    .description("List or organize ChatGPT conversations (ChatGPT only)");
  addWorkspaceFlags(chat.command(LIST_COMMAND_NAME))
    .description("List the conversations shown in the ChatGPT sidebar (may include Project chats)")
    .option(
      "--orphans",
      "List every loose conversation outside all Projects, read from the full ChatGPT history",
    )
    .action((_settings: ChatCommandSettings, command: Command) =>
      runChatList(command.optsWithGlobals() as ChatCommandSettings),
    );
  addWorkspaceFlags(chat.command("search <query...>"))
    .description("Search ChatGPT conversation history")
    .option("--limit <count>", "Maximum results (default: 20)")
    .option("--open", "Open the best match in the browser")
    .action((queryParts: string[], _settings: ChatCommandSettings, command: Command) =>
      runChatSearch(queryParts.join(SPACE), command.optsWithGlobals() as ChatCommandSettings),
    );
  addWorkspaceFlags(chat.command("move [idOrTitle...]"))
    .description("Move one or more conversations into a Project")
    .option("--project <name>", "Destination project name")
    .option(ID_OPTION, "Move several conversations by id in one session")
    .action((chatParts: string[], _settings: ChatCommandSettings, command: Command) =>
      runChatMove(chatParts.join(SPACE), command.optsWithGlobals() as ChatCommandSettings),
    );
  addWorkspaceFlags(chat.command("rename [idOrTitle...]"))
    .description("Rename one ChatGPT conversation")
    .option("--title <title>", "New conversation title")
    .option(ID_OPTION, "Rename the conversation with this id (one id only)")
    .action((chatParts: string[], _settings: ChatCommandSettings, command: Command) =>
      runChatRename(chatParts.join(SPACE), command.optsWithGlobals() as ChatCommandSettings),
    );
  addWorkspaceFlags(chat.command("archive [idOrTitle...]"))
    .description("Archive one or more conversations (reversible — hides from the sidebar)")
    .option(ID_OPTION, "Archive several conversations by id in one session")
    .action((chatParts: string[], _settings: ChatCommandSettings, command: Command) =>
      runChatArchive(chatParts.join(SPACE), command.optsWithGlobals() as ChatCommandSettings),
    );
  const organize = addOrganizationPacingFlags(addWorkspaceFlags(chat.command("organize")))
    .description("Run a resumable, rate-safe Conversation organization queue")
    .option(
      "--plan <fileOrJson>",
      "JSON array of {conversation, project} tasks (inline, @file, or a path)",
    )
    .option("--restart", "Restart this plan instead of resuming its persisted queue")
    .option(DRY_RUN_OPTION, "Validate and show the queue without opening Chrome or writing state")
    .action((_settings: ChatOrganizationSettings, command: Command) =>
      runChatOrganize(command.optsWithGlobals() as ChatOrganizationSettings),
    );
  addWorkspaceFlags(organize.command(STATUS_COMMAND_NAME))
    .description("Show the latest organization queue state and adaptive pace")
    .option(QUEUE_OPTION, QUEUE_DESCRIPTION)
    .action((_settings: ChatOrganizationSettings, command: Command) =>
      runChatOrganizeStatus(command.optsWithGlobals() as ChatOrganizationSettings),
    );
  addWorkspaceFlags(organize.command("pause"))
    .description("Pause the latest queue after its active UI operation")
    .option(QUEUE_OPTION, QUEUE_DESCRIPTION)
    .action((_settings: ChatOrganizationSettings, command: Command) =>
      runChatOrganizePause(command.optsWithGlobals() as ChatOrganizationSettings),
    );
  addOrganizationPacingFlags(addWorkspaceFlags(organize.command("resume")))
    .description("Resume the latest persisted organization queue")
    .option(QUEUE_OPTION, QUEUE_DESCRIPTION)
    .action((_settings: ChatOrganizationSettings, command: Command) =>
      runChatOrganizeResume(command.optsWithGlobals() as ChatOrganizationSettings),
    );

  const task = program.command("task").description("List or schedule ChatGPT Tasks (ChatGPT only)");
  addWorkspaceFlags(task.command(LIST_COMMAND_NAME))
    .description("List ChatGPT Scheduled tasks")
    .action((_settings: TaskCommandSettings, command: Command) =>
      runTaskList(command.optsWithGlobals() as TaskCommandSettings),
    );
  addWorkspaceFlags(task.command("create <prompt...>"))
    .description("Schedule a task via natural language")
    .option("--every <spec>", "Recurring cadence (e.g. day, or weekday at 9am)")
    .option("--at <spec>", "One-off run time (e.g. tomorrow at 9am)")
    .action((promptParts: string[], _settings: TaskCommandSettings, command: Command) =>
      runTaskCreate(promptParts.join(SPACE), command.optsWithGlobals() as TaskCommandSettings),
    );
};

const addBrowserCommandFlags = (command: Command): Command => {
  return command
    .option(REPO_OPTION, REPO_DESCRIPTION)
    .option(PORT_OPTION, MCP_PORT_DESCRIPTION)
    .option(DEBUG_PORT_OPTION, DEBUG_PORT_DESCRIPTION)
    .option(
      PROFILE_OPTION,
      "Chrome user-data-dir to drive (parallel accounts; default shared bridge profile)",
    )
    .option(MACHINE_READABLE_FLAG, MACHINE_READABLE_DESCRIPTION);
};

const registerFlowCommands = (program: Command): void => {
  const flow = program
    .command("flow")
    .description("Manage Google Flow clips, ingredients & projects (Flow only)");

  addBrowserCommandFlags(flow.command("clips"))
    .description("List clips in the current Flow project")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowClips(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command(PROJECTS_COMMAND_NAME))
    .description("List Flow projects")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowProjects(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command(DOWNLOAD_COMMAND_NAME))
    .description("Download clip mp4s (all, or --id <clipId...>)")
    .option(CLIP_ID_OPTION, "Specific clip id(s); omit to download every clip")
    .option(OUT_OPTION, "Output directory (default: <repo>/.bridge/downloads/flow)")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowDownload(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("generate"))
    .description("Generate a Veo clip from a Start keyframe + prompt (image-to-video)")
    .option("--start <imagePath>", "Start keyframe image (image-to-video)")
    .option(PROMPT_OPTION, "Shot / motion prompt")
    .option(OUT_OPTION, "Download directory (default: <repo>/.bridge/downloads/flow)")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowGenerate(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command(DELETE_COMMAND_NAME))
    .description("Move a clip to Flow Trash (recoverable)")
    .option(CLIP_ID_OPTION, "Clip id to trash")
    .option(YES_OPTION, "Confirm the delete")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowDelete(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command(RENAME_COMMAND_NAME))
    .description("Rename a clip")
    .option(CLIP_ID_OPTION, "Clip id to rename")
    .option(NAME_OPTION, "New clip name")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowRename(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("extend"))
    .description("Add a clip to a scene (Flow extend)")
    .option(CLIP_ID_OPTION, "Clip id to extend")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowExtend(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("reuse"))
    .description("Add a clip back to the prompt as input")
    .option(CLIP_ID_OPTION, "Clip id to reuse")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowReuse(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("project-rename"))
    .description("Rename the current Flow project")
    .option(NAME_OPTION, "New project name")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowProjectRename(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("project-delete"))
    .description("Delete the current Flow project (permanent)")
    .option(YES_OPTION, "Confirm the delete")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowProjectDelete(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("ingredients"))
    .description("List reference images attached to the current prompt")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowIngredients(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("ingredient-remove"))
    .description("Detach one prompt ingredient")
    .option("--id <mediaId...>", "Ingredient media id to remove")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowIngredientRemove(command.optsWithGlobals() as FlowCommandSettings),
    );
  addBrowserCommandFlags(flow.command("ingredient-clear"))
    .description("Detach every ingredient from the current prompt")
    .action((_settings: FlowCommandSettings, command: Command) =>
      runFlowIngredientClear(command.optsWithGlobals() as FlowCommandSettings),
    );
};

const addDesignTurnFlags = (command: Command): Command => {
  return command
    .option(MODEL_OPTION, 'Model label or id, e.g. "Haiku 4.5" (More models included)')
    .option(EFFORT_OPTION, EFFORT_DESCRIPTION)
    .option(ATTACH_OPTION, "Local files to attach to the message")
    .option("--auto-decide", 'Answer Claude\'s clarifying questions with "Decide for me"')
    .option("--no-wait", "Return while the turn is still running")
    .option(TIMEOUT_OPTION, "Max seconds to wait for the reply (default 600)");
};

const readDesignCommand = (parent: Command, name: string, description: string): Command => {
  return addBrowserCommandFlags(parent.command(name)).description(description);
};

const readDesignSettings = (command: Command): DesignCommandSettings =>
  command.optsWithGlobals() as DesignCommandSettings;

const registerDesignCommands = (program: Command): void => {
  const design = program
    .command("design")
    .description("Drive Claude Design projects, files, and Conversations (claude.ai/design)");

  readDesignCommand(
    design,
    "state",
    "Show where Claude Design is and what can be done there",
  ).action((_settings: DesignCommandSettings, command: Command) =>
    runDesignStatus(readDesignSettings(command)),
  );
  readDesignCommand(design, PROJECTS_COMMAND_NAME, "List projects (or design systems)")
    .option("--query <text>", "Search by name")
    .option("--design-systems", "List design systems instead of projects")
    .option(LIMIT_OPTION, "Maximum rows (default 50)")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignProjects(readDesignSettings(command)),
    );
  readDesignCommand(
    design,
    "catalog",
    "List templates, models with effort levels, design systems",
  ).action((_settings: DesignCommandSettings, command: Command) =>
    runDesignCatalog(readDesignSettings(command)),
  );
  readDesignCommand(design, "model", "Pick the model and effort (a project's composer, or home)")
    .option(PROJECT_ID_OPTION, "Project id (default: the home composer for new projects)")
    .option(MODEL_OPTION, 'Model label or id, e.g. "Sonnet 4.6" (More models included)')
    .option(EFFORT_OPTION, EFFORT_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignModel(readDesignSettings(command)),
    );
  readDesignCommand(design, "open", "Open (or focus) a project's tab")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignOpen(readDesignSettings(command)),
    );
  addDesignTurnFlags(
    readDesignCommand(design, "create", "Create a project — from a prompt (and template) or blank"),
  )
    .option(NAME_OPTION, "Project name")
    .option(PROMPT_OPTION, "First message; omit for a blank project")
    .option("--template <name>", "Home template, e.g. Slides (needs --prompt)")
    .option(DESIGN_SYSTEM_OPTION, "Design systems for a blank project")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignCreate(readDesignSettings(command)),
    );
  addDesignTurnFlags(readDesignCommand(design, "send", "Send a message and print Claude's reply"))
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option("--message <text>", "Message to send")
    .option(CONVERSATION_OPTION, "Conversation to continue (default: the active one)")
    .option(DESIGN_SYSTEM_OPTION, "Set the project's design systems first")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignSend(readDesignSettings(command)),
    );
  readDesignCommand(design, "read", "List Conversations and print the latest messages")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(CONVERSATION_OPTION, "Conversation (default: the active one)")
    .option(LIMIT_OPTION, "Most recent messages (default 20)")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignRead(readDesignSettings(command)),
    );
  readDesignCommand(design, "new-conversation", "Start a new Conversation in a project")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignNewConversation(readDesignSettings(command)),
    );
  readDesignCommand(design, "rename-conversation", "Rename a Conversation")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(CONVERSATION_OPTION, "Conversation id")
    .option("--title <text>", "New title")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignRenameConversation(readDesignSettings(command)),
    );
  readDesignCommand(design, RENAME_COMMAND_NAME, "Rename a project")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(NAME_OPTION, "New name")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignRename(readDesignSettings(command)),
    );
  readDesignCommand(design, "duplicate", "Duplicate a project")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignDuplicate(readDesignSettings(command)),
    );
  readDesignCommand(design, "favorite", "Star a project (or --off to unstar)")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option("--off", "Remove the star")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignFavorite(readDesignSettings(command)),
    );
  readDesignCommand(design, "use-design-systems", "Set a project's design systems")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(DESIGN_SYSTEM_OPTION, "Design system project ids")
    .option("--none", "Clear the project's design systems")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignUseDesignSystems(readDesignSettings(command)),
    );
  readDesignCommand(design, DELETE_COMMAND_NAME, "Delete a project (permanent)")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(YES_OPTION, "Confirm the delete")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignDelete(readDesignSettings(command)),
    );
  readDesignCommand(design, "files", "List a project's files")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignFiles(readDesignSettings(command)),
    );
  readDesignCommand(design, "put", "Add or replace project files from local files")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option("--file <path...>", "Local files to upload")
    .option("--dir <projectDir>", "Project folder to upload into (default: root)")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignPut(readDesignSettings(command)),
    );
  readDesignCommand(design, "rm", "Delete project files")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(PROJECT_PATH_OPTION, "Project file paths")
    .option(YES_OPTION, "Confirm the delete")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignRemove(readDesignSettings(command)),
    );
  readDesignCommand(design, DOWNLOAD_COMMAND_NAME, "Download project files")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(PROJECT_PATH_OPTION, "Files to download (default: all)")
    .option(OUT_OPTION, OUT_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignDownload(readDesignSettings(command)),
    );
  readDesignCommand(design, "export", "Download the project as a zip")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option(OUT_OPTION, OUT_DESCRIPTION)
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignExport(readDesignSettings(command)),
    );
  readDesignCommand(design, "share", "Set who can open a project and print its link")
    .option(PROJECT_ID_OPTION, PROJECT_ID_DESCRIPTION)
    .option("--access <who>", "private or workspace")
    .option("--permission <level>", "view, comment, or edit")
    .action((_settings: DesignCommandSettings, command: Command) =>
      runDesignShare(readDesignSettings(command)),
    );
};
