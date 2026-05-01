import type { CommandDef, CommandContext, ConnectorSetupResult } from "../../types/types.ts";
import { findModelProfile, listModelProfiles } from "../../core/model-catalog.ts";
import { bridgeLogPath } from "../../core/logging.ts";
import { loadCustomCommands, renderCustomCommandPrompt } from "../../core/custom-commands.ts";
import { loadProjectInstructions } from "../../core/project-instructions.ts";
import {
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  type SessionExport,
  type SessionMetadata,
} from "../../core/session-store.ts";
import { listCheckpoints, restoreCheckpoint } from "../../core/checkpoints.ts";
import { normalizePermissionMode, PERMISSION_MODES } from "../../core/permissions.ts";
import { ensureInsideRepo, trimOutput } from "../../mcp/sandbox.ts";
import { toolRegistry } from "../../mcp/tools/registry.ts";
import { filesCommand } from "./files.ts";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

const commands = new Map<string, CommandDef>();
const canonicalNames = new Set<string>();

/** Register a command. */
export function registerCommand(cmd: CommandDef): void {
  commands.set(cmd.name, cmd);
  canonicalNames.add(cmd.name);
  for (const alias of cmd.aliases ?? []) {
    commands.set(alias, cmd);
  }
}

/** Get all registered commands (for autocomplete). */
export function getAllCommands(): CommandDef[] {
  return [...canonicalNames]
    .map((name) => commands.get(name))
    .filter((cmd): cmd is CommandDef => !!cmd && !cmd.hidden);
}

/** Parse input as a potential command. Returns null if not a command string. */
export function parseCommand(input: string): { name: string; args: string } | null {
  const parsed = parseCommandInput(input);
  if (!parsed || !commands.has(parsed.name)) return null;
  return parsed;
}

/** Execute a command, returning true if it was handled. */
export async function executeCommand(
  input: string,
  ctx: CommandContext,
): Promise<boolean> {
  const parsed = parseCommandInput(input);
  if (!parsed) return false;

  const cmd = commands.get(parsed.name);
  if (!cmd) {
    const custom = await findCustomCommand(parsed.name, ctx);
    if (!custom) return false;

    await ctx.sendMessage(renderCustomCommandPrompt(custom, parsed.args));
    return true;
  }

  try {
    await cmd.handler(parsed.args, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Command /${parsed.name} failed: ${message}`);
  }
  return true;
}

/** Filter commands matching a partial name (after the /). */
export function matchCommands(partial: string): CommandDef[] {
  const q = partial.toLowerCase();
  return getAllCommands().filter((cmd) => cmd.name.toLowerCase().startsWith(q));
}

/** Build the project-agent wrapper used by /task and /work. */
export function buildProjectTaskPrompt(task: string, ctx: CommandContext): string {
  return buildProjectTaskPromptWithInstructions(task, ctx, "");
}

export function buildProjectTaskPromptWithInstructions(
  task: string,
  ctx: CommandContext,
  projectInstructions: string,
): string {
  return [
    "You are helping me modify this local project through the registered MCP connector.",
    "",
    "Project context:",
    `- Repo path: ${ctx.config.repoPath}`,
    "- The terminal bridge exposes narrow local tools; use them instead of guessing from memory.",
    "",
    "Available MCP tools:",
    "- grep_code: search source code and find relevant files.",
    "- read_file: inspect exact file contents before proposing or editing.",
    "- apply_patch: make minimal code edits through sandbox-validated patches.",
    "- run_tests: run only allowlisted verification commands.",
    "- git_diff: review the current local diff before reporting completion.",
    "",
    "Required workflow:",
    "1. First action: call an MCP tool such as grep_code or read_file to prove the connector is active.",
    "2. Inspect the repository structure with grep_code/read_file and identify the relevant modules.",
    "3. Use grep_code to find the files, commands, tests, selectors, and patterns involved.",
    "4. Use read_file on the important files before making claims or edits.",
    "5. Briefly explain the structure you found and the files that matter.",
    "6. Make the smallest correct change, following existing patterns and avoiding unrelated refactors.",
    "7. If behavior changes, add or update focused tests when practical.",
    "8. Run the smallest useful verification first, then broader tests/build when relevant.",
    "9. Use git_diff to review the final diff.",
    "10. Report changed files, verification commands, and remaining risks.",
    "",
    "Rules:",
    "- Do not answer from guessing when the MCP tools can inspect the repo.",
    "- Do not ask me to paste tree/find output for this repo; use the MCP connector tools instead.",
    "- If you see only a hosted sandbox such as /mnt/data, or you ask for a zip/tree/find output, the connector is not active.",
    "- Do not use raw shell access or ask for broad local access.",
    "- Do not commit unless I explicitly ask.",
    "- If the MCP connector tools are unavailable in this chat, say: MCP connector is not active in this chat.",
    "- If a needed operation is not available through the tools, say exactly what is missing.",
    ...(projectInstructions.trim()
      ? [
          "",
          "Project instruction files:",
          projectInstructions.trim(),
        ]
      : []),
    "",
    "User task:",
    task.trim(),
  ].join("\n");
}

const BUILTIN_COMMANDS: CommandDef[] = [
  filesCommand,
  {
    name: "help",
    description: "List all available commands",
    handler: async (_args: string, ctx: CommandContext) => {
      const all = getAllCommands();
      console.log("\nAvailable commands:\n");
      for (const cmd of all) {
        console.log(`  /${cmd.name.padEnd(16)} ${cmd.description}`);
      }
      const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
      if (custom.length > 0) {
        console.log("\nCustom commands:\n");
        for (const cmd of custom) {
          console.log(`  /${cmd.name.padEnd(16)} ${cmd.description ?? `${cmd.source} command`}`);
        }
      }
      console.log("");
    },
  },
  {
    name: "conversations",
    description: "List and open ChatGPT conversations",
    handler: async (args: string, ctx: CommandContext) => {
      const conversations = await ctx.orchestrator.listConversations();

      if (conversations.length === 0) {
        console.log("No conversations found in sidebar.");
        return;
      }

      if (args.trim()) {
        const query = args.trim().toLowerCase();
        const match = conversations.find(
          (c) => c.id.toLowerCase().includes(query) || c.title.toLowerCase().includes(query),
        );
        if (match) {
          console.log(`Navigating to: ${match.title} (${match.id})`);
          await ctx.orchestrator.navigateToConversation(match.url);
          return;
        }
        console.log(`No conversation matching "${args.trim()}".`);
        return;
      }

      console.log("\nChatGPT Conversations:\n");
      for (let i = 0; i < conversations.length; i++) {
        const c = conversations[i];
        console.log(`  ${String(i + 1).padStart(2)}. ${c.title}`);
      }
      console.log("\nUse /resume <number> to continue a conversation.\n");
    },
  },
  {
    name: "resume",
    aliases: ["open"],
    description: "Resume a browser conversation or local session",
    handler: async (args: string, ctx: CommandContext) => {
      const query = args.trim();
      if (!query) {
        console.log("Usage: /resume <number|title|id> or /resume --last (use /conversations or /sessions)");
        return;
      }

      if (query === "--last") {
        const latest = await getLatestSession();
        if (!latest) {
          console.log("No local bridge sessions found.");
          return;
        }
        await ctx.session?.setId(latest.metadata.id);
        console.log(formatSessionSummary(latest.metadata, ctx.session?.getId()));
        return;
      }

      const localSession = await tryLoadSession(query);
      if (localSession) {
        await ctx.session?.setId(localSession.metadata.id);
        console.log(formatSessionSummary(localSession.metadata, ctx.session?.getId()));
        return;
      }

      const conversations = await ctx.orchestrator.listConversations();
      const num = parseInt(query, 10);
      const target = Number.isNaN(num)
        ? conversations.find(
          (c) => c.id.toLowerCase().includes(query.toLowerCase())
            || c.title.toLowerCase().includes(query.toLowerCase()),
        )
        : conversations[num - 1];

      if (!target) {
        console.log(`No conversation matching "${query}". Use /conversations to see the list.`);
        return;
      }

      console.log(`Resuming: ${target.title}`);
      await ctx.orchestrator.navigateToConversation(target.url);
    },
  },
  {
    name: "new",
    description: "Start a new ChatGPT conversation",
    handler: async (_args: string, ctx: CommandContext) => {
      await ctx.orchestrator.newConversation();
      console.log("Started new conversation.");
    },
  },
  {
    name: "model",
    description: "Show or switch the ChatGPT model",
    handler: async (args: string, ctx: CommandContext) => {
      const query = args.trim();

      if (query) {
        const model = await ctx.orchestrator.switchModel(query);
        ctx.counter.setModel(model);
        const profile = findModelProfile(model);
        console.log(
          `Model switched to ${model}. Context estimate now uses ${profile.contextWindow.toLocaleString()} tokens.`,
        );
        return;
      }

      const current = await ctx.orchestrator.detectModel();
      ctx.counter.setModel(current);
      const profile = findModelProfile(current);
      console.log(`\nCurrent model: ${current}`);
      console.log(`Context window: ${profile.contextWindow.toLocaleString()} tokens`);
      if (profile.maxOutputTokens) {
        console.log(`Max output:     ${profile.maxOutputTokens.toLocaleString()} tokens`);
      }
      console.log(`Source:         ${profile.sourceUrl}`);

      const available = await ctx.orchestrator.listModels();
      if (available.length > 0) {
        console.log("\nBrowser models:");
        for (const model of available) {
          console.log(`  ${model.selected ? "*" : " "} ${model.label}`);
        }
        console.log("\nUse /model <name> to switch.");
        return;
      }

      console.log("\nKnown context profiles:");
      for (const model of listModelProfiles()) {
        console.log(`  ${model.label.padEnd(24)} ${model.contextWindow.toLocaleString()} ctx`);
      }
    },
  },
  {
    name: "rewind",
    aliases: ["retry"],
    description: "Edit the last prompt, or restore checkpoint files",
    handler: async (args: string, ctx: CommandContext) => {
      const parts = splitArgs(args);
      if (parts[0] === "--files" || parts[0] === "--both") {
        const checkpointId = parts[1];
        if (!checkpointId) {
          console.log(`Usage: /rewind ${parts[0]} <checkpoint-id> [replacement prompt]`);
          return;
        }
        const restored = await restoreCheckpoint({ repoRoot: ctx.config.repoPath, checkpointId });
        console.log(
          `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
        );
        if (parts[0] === "--files") return;

        const replacement = parts.slice(2).join(" ").trim() || undefined;
        await ctx.orchestrator.rewindLastPrompt(replacement);
        console.log(replacement ? "Restored files and rewound with replacement prompt." : "Restored files and rewound the last prompt.");
        return;
      }

      const replacement = args.trim() || undefined;
      await ctx.orchestrator.rewindLastPrompt(replacement);
      console.log(replacement ? "Rewound with replacement prompt." : "Rewound the last prompt.");
    },
  },
  {
    name: "stop",
    description: "Stop the active ChatGPT response",
    handler: async (_args: string, ctx: CommandContext) => {
      const stopped = await ctx.orchestrator.stopResponse();
      console.log(stopped ? "Stopped active response." : "No active response to stop.");
    },
  },
  {
    name: "compact",
    description: "Ask ChatGPT for a concise progress summary",
    handler: async (_args: string, ctx: CommandContext) => {
      await ctx.sendMessage(
        "Summarize our progress so far in a structured format: what we've done, what's in progress, what's next. Be concise.",
      );
      console.log("Compaction summary requested. Start a new conversation to continue with that summary.");
    },
  },
  {
    name: "task",
    aliases: ["work"],
    description: "Send a project-agent task with MCP tool instructions",
    handler: async (args: string, ctx: CommandContext) => {
      const task = args.trim();
      if (!task) {
        console.log("Usage: /task <project task>");
        return;
      }

      const instructions = await loadProjectInstructions(ctx.config.repoPath);
      await ctx.sendMessage(buildProjectTaskPromptWithInstructions(task, ctx, instructions.promptText));
    },
  },
  {
    name: "commands",
    description: "List project/user custom commands",
    handler: async (_args: string, ctx: CommandContext) => {
      const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
      if (custom.length === 0) {
        console.log("No custom commands found in .bridge/commands or ~/.chatgpt-bridge/commands.");
        return;
      }
      console.log("\nCustom commands:\n");
      for (const command of custom) {
        console.log(`  /${command.name.padEnd(16)} ${command.description ?? `${command.source} command`}`);
      }
      console.log("");
    },
  },
  {
    name: "context",
    description: "Show context window usage",
    handler: async (_args: string, ctx: CommandContext) => {
      console.log(`Context estimate for ${ctx.counter.modelLabel}: ${ctx.counter.summary}`);
    },
  },
  {
    name: "logs",
    description: "Show the local bridge log file path",
    handler: async (_args: string, _ctx: CommandContext) => {
      console.log(`Bridge logs: ${bridgeLogPath()}`);
    },
  },
  {
    name: "sessions",
    description: "List local bridge sessions",
    handler: async (_args: string, ctx: CommandContext) => {
      const sessions = await listSessions();
      if (sessions.length === 0) {
        console.log("No local bridge sessions found.");
        return;
      }
      const currentId = ctx.session?.getId();
      console.log("\nLocal sessions:\n");
      for (const session of sessions.slice(0, 20)) {
        const marker = session.id === currentId ? "*" : " ";
        console.log(
          `${marker} ${session.id.padEnd(38)} ${session.updatedAt} ${session.model ?? "unknown"} ${session.repoPath}`,
        );
      }
      console.log("\nUse /resume --last or /resume <session-id> to make a session current.\n");
    },
  },
  {
    name: "transcript",
    description: "Print local session transcript",
    handler: async (args: string, ctx: CommandContext) => {
      const sessionId = await resolveSessionId(args, ctx);
      if (!sessionId) {
        console.log("No local session selected. Use /sessions first.");
        return;
      }
      const exported = await exportSession(sessionId);
      console.log(trimOutput(exported.transcript || "(empty transcript)", 40_000));
    },
  },
  {
    name: "copy",
    description: "Copy local session transcript to clipboard",
    handler: async (args: string, ctx: CommandContext) => {
      const sessionId = await resolveSessionId(args, ctx);
      if (!sessionId) {
        console.log("No local session selected. Use /sessions first.");
        return;
      }
      const exported = await exportSession(sessionId);
      await copyTextToClipboard(exported.transcript);
      console.log(`Copied transcript for ${sessionId} to clipboard.`);
    },
  },
  {
    name: "export",
    description: "Export local session transcript",
    handler: async (args: string, ctx: CommandContext) => {
      const selection = await resolveSessionExportArgs(args, ctx);
      if (!selection.sessionId) {
        console.log("No local session selected. Use /sessions first.");
        return;
      }
      const exported = await exportSession(selection.sessionId);
      const targetPath = selection.outputPath ?? defaultExportPath(selection.sessionId);
      const content = exportContentForPath(targetPath, exported);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf-8");
      console.log(`Exported ${selection.sessionId} to ${targetPath}`);
    },
  },
  {
    name: "permissions",
    description: "Show or switch MCP permission mode",
    handler: async (args: string, ctx: CommandContext) => {
      const next = args.trim();
      if (!next) {
        console.log(`Permission mode: ${ctx.permission?.getMode() ?? ctx.config.permissionMode ?? "auto"}`);
        console.log(`Available: ${PERMISSION_MODES.join(", ")}`);
        return;
      }
      const mode = normalizePermissionMode(next);
      if (mode !== next) {
        console.log(`Unknown permission mode "${next}". Available: ${PERMISSION_MODES.join(", ")}`);
        return;
      }
      await ctx.permission?.setMode(mode);
      ctx.config.permissionMode = mode;
      console.log(`Permission mode set to ${mode}.`);
    },
  },
  {
    name: "checkpoints",
    description: "List file checkpoints",
    handler: async (_args: string, ctx: CommandContext) => {
      const checkpoints = await listCheckpoints({ repoRoot: ctx.config.repoPath });
      if (checkpoints.length === 0) {
        console.log("No checkpoints found.");
        return;
      }
      console.log("\nCheckpoints:\n");
      for (const checkpoint of checkpoints.slice(0, 20)) {
        console.log(
          `  ${checkpoint.id.padEnd(38)} ${checkpoint.phase.padEnd(6)} ${checkpoint.fileCount} files ${checkpoint.label ?? ""}`,
        );
      }
      console.log("\nUse /restore <checkpoint-id> or /rewind --files <checkpoint-id>.\n");
    },
  },
  {
    name: "restore",
    description: "Restore files from a checkpoint",
    handler: async (args: string, ctx: CommandContext) => {
      const parts = splitArgs(args);
      const checkpointId = parts[0];
      if (!checkpointId) {
        console.log("Usage: /restore <checkpoint-id> [path ...]");
        return;
      }
      const restored = await restoreCheckpoint({
        repoRoot: ctx.config.repoPath,
        checkpointId,
        paths: parts.slice(1),
      });
      console.log(
        `Restored checkpoint ${checkpointId}: ${restored.restored.length} restored, ${restored.removed.length} removed.`,
      );
    },
  },
  {
    name: "review",
    description: "Ask ChatGPT to review local changes",
    handler: async (args: string, ctx: CommandContext) => {
      const scope = args.trim() || "working";
      await ctx.sendMessage([
        "Review the local repository changes with a code-review stance.",
        "Prioritize bugs, regressions, security risks, and missing tests.",
        "Use the MCP tools to inspect the repo and diff before making claims.",
        `Review scope: ${scope}`,
      ].join("\n"));
    },
  },
  {
    name: "status",
    description: "Show bridge status",
    handler: async (_args: string, ctx: CommandContext) => {
      console.log(formatBridgeStatus(ctx));
    },
  },
  {
    name: "statusline",
    description: "Show status bar fields",
    handler: async (_args: string, ctx: CommandContext) => {
      console.log(formatBridgeStatus(ctx));
    },
  },
  {
    name: "mcp",
    description: "Show MCP connector setup and exposed tools",
    handler: async (_args: string, ctx: CommandContext) => {
      console.log(formatMcpDiagnostics(ctx));
    },
  },
  {
    name: "connector",
    description: "Open ChatGPT MCP connector setup",
    handler: async (_args: string, ctx: CommandContext) => {
      const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
      if (!connector) {
        console.log([
          "No public connector URL is available.",
          `Local MCP server: http://localhost:${ctx.config.mcpPort}`,
          "ChatGPT cannot normally reach localhost from the browser connector.",
          "Restart the bridge and fix Cloudflare Tunnel, then run /connector again.",
        ].join("\n"));
        return;
      }

      console.log(formatMcpDiagnostics(ctx));
      if (!ctx.orchestrator.openConnectorSetup) {
        console.log("\nBrowser setup automation is unavailable. Open ChatGPT Settings -> Apps -> Advanced settings -> Create app and paste the Connector URL.");
        return;
      }

      const result = await ctx.orchestrator.openConnectorSetup(connector);
      console.log(formatConnectorSetupResult(result));
    },
  },
  {
    name: "clear",
    description: "Clear the terminal chat view",
    handler: async (_args: string, ctx: CommandContext) => {
      ctx.clearMessages?.();
      console.log("Cleared terminal chat view. Browser conversation, context estimate, and local session logs are unchanged.");
    },
  },
  {
    name: "attach-image",
    description: "Attach a repo image file to ChatGPT",
    handler: async (args: string, ctx: CommandContext) => {
      const target = args.trim();
      if (!target) {
        console.log("Usage: /attach-image <repo-relative-image-path>");
        return;
      }
      const imagePath = resolveRepoFilePath(ctx.config.repoPath, target);
      assertImagePath(imagePath);
      if (!ctx.orchestrator.attachFiles) {
        console.log("Browser file attachment is not available.");
        return;
      }
      await ctx.orchestrator.attachFiles([imagePath]);
      console.log(`Attached image: ${imagePath}`);
    },
  },
  {
    name: "screenshot",
    description: "Capture desktop/mobile screenshots for a URL",
    handler: async (args: string, _ctx: CommandContext) => {
      const url = args.trim();
      if (!url) {
        console.log("Usage: /screenshot <url>");
        return;
      }
      const files = await captureUrlScreenshots(url);
      console.log("Screenshots:");
      for (const file of files) console.log(`  ${file}`);
    },
  },
  {
    name: "ui-qa",
    description: "Capture UI screenshots and ask ChatGPT to review them",
    handler: async (args: string, ctx: CommandContext) => {
      const url = args.trim();
      if (!url) {
        console.log("Usage: /ui-qa <url>");
        return;
      }
      const files = await captureUrlScreenshots(url);
      if (ctx.orchestrator.attachFiles) {
        await ctx.orchestrator.attachFiles(files);
      }
      await ctx.sendMessage([
        `Review the UI at ${url}.`,
        "I attached desktop and mobile screenshots when the browser supports file attachment.",
        "Focus on layout breakage, overlapping text, responsive behavior, accessibility, and concrete fixes.",
        "",
        "Screenshot files:",
        ...files.map((file) => `- ${file}`),
      ].join("\n"));
      console.log(`UI QA requested with ${files.length} screenshots.`);
    },
  },
  {
    name: "diff",
    description: "Show current git diff",
    handler: async (_args: string, ctx: CommandContext) => {
      await ctx.sendMessage("Show me the current git diff for the repository.");
    },
  },
  {
    name: "exit",
    description: "Shutdown the bridge",
    handler: async (_args: string, ctx: CommandContext) => {
      if (ctx.shutdown) {
        await ctx.shutdown();
        return;
      }
      console.log("Shutting down...");
      process.exit(0);
    },
  },
];

for (const command of BUILTIN_COMMANDS) {
  registerCommand(command);
}

function parseCommandInput(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  if (!name) return null;
  return { name, args };
}

async function findCustomCommand(name: string, ctx: CommandContext) {
  const custom = await loadCustomCommands({ repoRoot: ctx.config.repoPath });
  return custom.find((command) => command.name === name);
}

async function tryLoadSession(sessionId: string) {
  try {
    return await loadSession(sessionId);
  } catch {
    return null;
  }
}

function formatSessionSummary(session: SessionMetadata, currentId?: string): string {
  const marker = session.id === currentId ? "current" : "loaded";
  return [
    `Local session ${marker}: ${session.id}`,
    `Repo: ${session.repoPath}`,
    `Model: ${session.model ?? "unknown"}`,
    `Context: ${session.contextLimit.toLocaleString()} tokens`,
    `Updated: ${session.updatedAt}`,
    `Tunnel: ${session.tunnelUrl ?? "none"}`,
  ].join("\n");
}

async function resolveSessionId(args: string, ctx: CommandContext): Promise<string | null> {
  const [requested] = splitArgs(args);
  if (requested) return requested;
  if (ctx.session?.getId()) return ctx.session.getId();
  const latest = await getLatestSession();
  return latest?.metadata.id ?? null;
}

async function resolveSessionExportArgs(
  args: string,
  ctx: CommandContext,
): Promise<{ sessionId: string | null; outputPath?: string }> {
  const parts = splitArgs(args);
  if (parts.length === 0) {
    return { sessionId: await resolveSessionId("", ctx) };
  }

  const first = parts[0];
  const session = await tryLoadSession(first);
  if (session) {
    return {
      sessionId: session.metadata.id,
      outputPath: parts[1] ? resolve(parts[1]) : undefined,
    };
  }

  return {
    sessionId: await resolveSessionId("", ctx),
    outputPath: resolve(first),
  };
}

function defaultExportPath(sessionId: string): string {
  return join(homedir(), ".chatgpt-bridge", "exports", `${sessionId}.md`);
}

function exportContentForPath(path: string, exported: SessionExport): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return exported.json;
  if (extension === ".jsonl") return exported.jsonl;
  return exported.transcript;
}

async function copyTextToClipboard(text: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile("pbcopy", (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
    child.stdin?.end(text);
  });
}

function formatBridgeStatus(ctx: CommandContext): string {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  return [
    `Repo: ${ctx.config.repoPath}`,
    `Branch: ${ctx.statusline?.branch ?? "unknown"}`,
    `Session: ${ctx.session?.getId() ?? "none"}`,
    `Model: ${ctx.counter.modelLabel}`,
    `Context: ${ctx.counter.summary}`,
    `Permission: ${ctx.permission?.getMode() ?? ctx.config.permissionMode ?? "auto"}`,
    `Tool calls: ${ctx.statusline?.toolCallCount() ?? 0}`,
    `Tunnel: ${ctx.config.tunnelUrl ?? "none"}`,
    `Connector: ${connector ?? "none"}`,
  ].join("\n");
}

function formatMcpDiagnostics(ctx: CommandContext): string {
  const connector = mcpConnectorUrl(ctx.config.tunnelUrl);
  const toolCallCount = ctx.statusline?.toolCallCount() ?? 0;
  return [
    "MCP bridge diagnostics:",
    `Local server: http://localhost:${ctx.config.mcpPort}`,
    `Tunnel: ${ctx.config.tunnelUrl ?? "none"}`,
    `Connector: ${connector ?? "none"}`,
    `Tools: ${[...toolRegistry.keys()].join(", ")}`,
    `Tool calls observed this session: ${toolCallCount}`,
    `Status: ${toolCallCount > 0 ? "MCP tool calls observed in this bridge session." : "No MCP tool calls observed yet; the current ChatGPT chat may not have the connector enabled."}`,
    "",
    "If ChatGPT says it cannot access local files:",
    "1. Startup automatically syncs the current Connector URL into ChatGPT when browser automation is connected.",
    "2. Run /connector only to retry that browser setup flow after a UI drift or account permission issue.",
    "3. Ask explicitly: use the chatgpt-local-bridge connector; do not answer from memory.",
    "4. A reply mentioning /mnt/data, upload a zip, or paste tree/find output means ChatGPT is not using this local connector.",
  ].join("\n");
}

function formatConnectorSetupResult(result: ConnectorSetupResult): string {
  return [
    "",
    "Connector setup result:",
    `URL: ${result.connectorUrl}`,
    `Submitted: ${result.completed ? "yes" : "no"}`,
    ...(result.steps.length > 0 ? ["", "Steps:", ...result.steps.map((step) => `- ${step}`)] : []),
    ...(result.warnings.length > 0 ? ["", "Needs manual attention:", ...result.warnings.map((warning) => `- ${warning}`)] : []),
    "",
    "Automatic startup handles this on each restart when the browser is connected. Manual fallback: ChatGPT Settings -> Apps -> Advanced settings -> Create app, paste the Connector URL, choose no authentication, then enable it in Developer Mode for this chat.",
  ].join("\n");
}

function mcpConnectorUrl(tunnelUrl?: string): string | null {
  if (!tunnelUrl) return null;
  const normalized = tunnelUrl.replace(/\/+$/, "");
  return normalized.endsWith("/mcp") || normalized.endsWith("/sse") ? normalized : `${normalized}/mcp`;
}

function resolveRepoFilePath(repoRoot: string, input: string): string {
  if (isAbsolute(input)) {
    const rel = relative(resolve(repoRoot), resolve(input));
    return ensureInsideRepo(rel || ".", repoRoot);
  }
  return ensureInsideRepo(input, repoRoot);
}

function assertImagePath(path: string): void {
  const extension = extname(path).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) {
    throw new Error(`Unsupported image type: ${basename(path)}`);
  }
}

async function captureUrlScreenshots(url: string): Promise<string[]> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(homedir(), ".chatgpt-bridge", "screenshots", stamp);
  await mkdir(dir, { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const outputs: string[] = [];
  try {
    const viewports = [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ];
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.goto(parsed.toString(), { waitUntil: "networkidle", timeout: 45_000 });
      const file = join(dir, `${viewport.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      outputs.push(file);
    }
  } finally {
    await browser.close();
  }

  return outputs;
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of input.trim()) {
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) args.push(current);
  return args;
}
