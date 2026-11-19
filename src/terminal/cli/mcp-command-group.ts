import { type Command, Option } from "commander";
import packageJson from "@/../package.json" with { type: "json" };
import { DEFAULT_ASK_TIMEOUT_SECONDS } from "@/app-defaults.ts";
import { PROVIDER_IDS } from "@/provider-settings.ts";
import { createUsageError } from "@/terminal/cli/cli-failure.ts";
import {
  addBrowserTargetOptions,
  createDebugPortOption,
  createJsonOption,
  createNonNegativeIntegerOption,
  createPortOption,
  createPositiveIntegerOption,
  createProfileOption,
  createProviderOption,
  createRepoOption,
  createSecondsOption,
  createYesOption,
  runWithSettings,
  runWithWords,
} from "@/terminal/cli/cli-options.ts";
import type {
  AskSettings,
  BrowserStatusSettings,
  BrowserTargetSettings,
  CacheCommandSettings,
  ChatgptCommandSettings,
  ChromeStartSettings,
  DownloadCommandSettings,
  ServeSettings,
} from "@/terminal/cli/cli-types.ts";
import { runAsk } from "@/terminal/commands/ask/ask-command.ts";
import { runCacheList, runCachePrune } from "@/terminal/commands/cache-commands.ts";
import { runChatgptInspect } from "@/terminal/commands/chatgpt-inspect-command.ts";
import { runDownload } from "@/terminal/commands/download-command.ts";
import {
  runBrowserStatus,
  runChromeStart,
  runSessions,
  runStop,
} from "@/terminal/commands/engine-commands.ts";
import { runServe } from "@/terminal/commands/serve-command.ts";
import { runInteractiveCli } from "@/terminal/tui/interactive-cli.ts";

const BROWSER_STATUS_DESCRIPTION = "Show Chrome/debug-port status";
const PROFILE_ROOT_DESCRIPTION = "Chrome profile root (default: shared bridge profile)";
const MCP_PORT_DESCRIPTION = "MCP server port";
const FAN_OUT_COMMA_NOTE = "comma-separated for fan-out";

// The root command, the interactive mode, and the headless and browser-session commands.
export class McpCommands {
  register = (program: Command): void => {
    this.registerRoot(program);
    this.registerAsk(program);
    this.registerDownload(program);
    this.registerSessionCommands(program);
    this.registerChrome(program);
    this.registerCache(program);
    this.registerStop(program);
    this.registerServe(program);
  };

  private runInteractiveMode = async (_settings: unknown, command: Command): Promise<void> => {
    const isThereNoTerminal = process.stdin.isTTY !== true || process.stdout.isTTY !== true;
    if (isThereNoTerminal) {
      command.outputHelp({ error: true });
      throw createUsageError(
        "bridge: the interactive mode needs a terminal. Use `bridge ask <prompt>` for piped use.",
      );
    }

    await runInteractiveCli(command.opts());
  };

  private registerRoot = (program: Command): void => {
    program
      .name("bridge")
      .description("Terminal CLI that bridges ChatGPT or Gemini with local tools via MCP")
      .version(packageJson.version)
      .addOption(createRepoOption("Path to the target repository (default: cwd)"))
      .addOption(createPortOption("MCP server port (default: 8765)"))
      .addOption(createProviderOption())
      .option("--no-browser", "Skip Chrome browser connection")
      .addOption(createDebugPortOption())
      .addOption(createProfileOption())
      .action(this.runInteractiveMode);
  };

  private registerAsk = (program: Command): void => {
    program
      .command("ask [prompt...]")
      .description("Send one prompt and print the reply, or fan out several with --fan-out")
      .addOption(createRepoOption("Target repository for MCP tools"))
      .addOption(createPortOption(MCP_PORT_DESCRIPTION))
      .addOption(
        new Option(
          "--provider <names>",
          `Browser provider: ${PROVIDER_IDS.join(", ")}; ${FAN_OUT_COMMA_NOTE}`,
        ),
      )
      .option("--strict", "Fan-out: exit non-zero if any task fails (default: only if all fail)")
      .addOption(
        createJsonOption(
          "Emit a JSON object { sessionId, model, reply, contextTokens, conversationId, url } (or the fan-out result)",
        ),
      )
      .option(
        "--tools",
        "Start the tunnel + connector so ChatGPT can call local tools (ChatGPT only)",
      )
      .option("--fresh", "Start a new conversation before asking")
      .option("--conversation <idOrUrl>", "Open a ChatGPT conversation by id or URL before asking")
      .option("--model <name>", "Switch model before asking")
      .addOption(
        createSecondsOption(
          "--timeout <seconds>",
          `Max seconds to wait for the reply (default ${DEFAULT_ASK_TIMEOUT_SECONDS})`,
        ),
      )
      .option("--attach <path...>", "Attach repo-relative image file(s) before asking")
      .addOption(
        createPositiveIntegerOption(
          "--images <count>",
          "Wait for ChatGPT to finish generating this many images before returning",
        ),
      )
      .option(
        "--fan-out <fileOrJson>",
        "Fan out several Conversations at once: a JSON array of {prompt,provider?,conversation?,label?,isolate?} (inline, @file, or a path)",
      )
      .addOption(
        createPositiveIntegerOption(
          "--max-concurrency <n>",
          "Fan-out: max Conversations in flight at once (default 1)",
        ),
      )
      .addOption(
        createPositiveIntegerOption(
          "--limit <n>",
          "Fan-out: max tasks to run and return per call (default 20)",
        ),
      )
      .addOption(
        createNonNegativeIntegerOption(
          "--offset <n>",
          "Fan-out: skip this many tasks before running (pagination)",
        ),
      )
      .addOption(
        createPositiveIntegerOption(
          "--max-reply-chars <n>",
          "Fan-out: truncate each reply to this many characters (default 2000)",
        ),
      )
      .addOption(createDebugPortOption())
      .addOption(createProfileOption())
      .action(runWithWords<AskSettings>(runAsk));
  };

  private registerDownload = (program: Command): void => {
    program
      .command("download")
      .description("Download a conversation's attachments/images (non-interactive, ChatGPT only)")
      .addOption(createRepoOption("Target repository"))
      .addOption(createPortOption(MCP_PORT_DESCRIPTION))
      .addOption(createProviderOption())
      .option("--conversation <id>", "Conversation id (default: current page)")
      .option("--out <dir>", "Output directory (default: <repo>/.bridge/downloads/<id>)")
      .option("--id <attachmentId...>", "Specific attachment id(s); omit to download all")
      .option("--scan", "Rescan conversation attachments into manifest without downloading")
      .addOption(createJsonOption("Emit a JSON array of results"))
      .addOption(createDebugPortOption())
      .addOption(createProfileOption())
      .action(runWithSettings<DownloadCommandSettings>(runDownload));
  };

  private registerSessionCommands = (program: Command): void => {
    program
      .command("sessions")
      .description("List stored bridge sessions as JSON")
      .action(runSessions);
    addBrowserTargetOptions(program.command("status"))
      .description("Show browser/debug-port status")
      .addOption(createJsonOption())
      .action(runWithSettings<BrowserStatusSettings>(runBrowserStatus));
  };

  private registerStop = (program: Command): void => {
    addBrowserTargetOptions(program.command("stop"))
      .description("Close the warm bridge browser")
      .action(runWithSettings<BrowserTargetSettings>(runStop));
  };

  private registerServe = (program: Command): void => {
    program
      .command("serve")
      .description(
        "Serve the outbound MCP `ask` tool over stdio so other agents can drive web chats",
      )
      .addOption(createRepoOption())
      .addOption(
        createSecondsOption(
          "--timeout <seconds>",
          "Default per-provider reply timeout when an `ask` caller omits one",
        ),
      )
      .action(runWithSettings<ServeSettings>(runServe));
  };

  private registerChrome = (program: Command): void => {
    const chrome = program.command("chrome").description("Manage the local Chrome debug session");

    chrome
      .command("start")
      .description("Start the shared bridge profile with the bridge debug port")
      .addOption(createRepoOption())
      .addOption(createProviderOption())
      .addOption(
        createDebugPortOption(
          "Chrome remote-debugging port to spawn on (parallel accounts; default 9222)",
        ),
      )
      .addOption(
        createProfileOption(
          "Chrome user-data-dir to spawn (parallel accounts; default shared bridge profile)",
        ),
      )
      .action(runWithSettings<ChromeStartSettings>(runChromeStart));
    addBrowserTargetOptions(chrome.command("status"))
      .description(BROWSER_STATUS_DESCRIPTION)
      .addOption(createJsonOption())
      .action(runWithSettings<BrowserStatusSettings>(runBrowserStatus));
    addBrowserTargetOptions(chrome.command("stop"))
      .description("Close the Chrome debug-port process")
      .action(runWithSettings<BrowserTargetSettings>(runStop));
  };

  private registerCache = (program: Command): void => {
    const cache = program.command("cache").description("Inspect or prune generated Chrome cache");

    cache
      .command("list")
      .description("List generated Chrome cache paths safe for bridge cleanup")
      .addOption(createProfileOption(PROFILE_ROOT_DESCRIPTION))
      .addOption(createJsonOption())
      .action(runWithSettings<CacheCommandSettings>(runCacheList));
    cache
      .command("prune")
      .description("Prune generated Chrome cache paths; identity data is never targeted")
      .addOption(createProfileOption(PROFILE_ROOT_DESCRIPTION))
      .option("--dry-run", "Preview deletions without removing files")
      .addOption(createYesOption("Confirm deletion"))
      .addOption(createJsonOption())
      .action(runWithSettings<CacheCommandSettings>(runCachePrune));
  };

  registerChatgptInspect = (program: Command): void => {
    const chatgpt = program
      .command("chatgpt")
      .description("Inspect the live ChatGPT render (ChatGPT only)");

    chatgpt
      .command("inspect")
      .description("Print the current ChatGPT render state (streaming, image progress, limits)")
      .addOption(createRepoOption())
      .addOption(createPortOption())
      .option(
        "--all-tabs",
        "Report every ChatGPT tab in the browser instead of just the active one",
      )
      .addOption(createDebugPortOption())
      .addOption(createProfileOption())
      .addOption(createJsonOption())
      .action(runWithSettings<ChatgptCommandSettings>(runChatgptInspect));
  };
}
