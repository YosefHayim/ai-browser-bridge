#!/usr/bin/env node
/**
 * Merges terminal/commands/, headless/, and run-tui.ts into cli-runner.class.ts.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const TERMINAL_DIR = join(import.meta.dirname, "..", "src/features/terminal");
const OUT = join(TERMINAL_DIR, "cli-runner.class.ts");

const MERGE_DIRS = ["commands", "headless"];
const MERGE_FILES = ["run-tui.ts"];

const SKIP = new Set([
  "cli-runner.class.ts",
  "ask.ts",
  "ask.types.ts",
  "download.types.ts",
]);

/** Evaluation order when merged into one module (builtins/registry last). */
const FILE_ORDER = [
  "commands/commands.config.ts",
  "commands/prompts.ts",
  "commands/formatters.ts",
  "commands/files.format.ts",
  "commands/files.helpers.ts",
  "commands/files.download.helpers.ts",
  "commands/files.ts",
  "commands/handlers/helpers/split-args.ts",
  "commands/handlers/helpers/session-store.ts",
  "commands/handlers/helpers/try-load-session.ts",
  "commands/handlers/helpers/resolve-session-id.ts",
  "commands/handlers/helpers/repo-file-path.ts",
  "commands/handlers/helpers/copy-clipboard.ts",
  "commands/handlers/helpers/capture-screenshots.ts",
  "commands/handlers/helpers/session-export.ts",
  "commands/handlers/browser/general.ts",
  "commands/handlers/browser/help.ts",
  "commands/handlers/browser/media.ts",
  "commands/handlers/browser.ts",
  "commands/handlers/session/conversations.ts",
  "commands/handlers/session/list-sessions.ts",
  "commands/handlers/session/resume.ts",
  "commands/handlers/session/transcript.ts",
  "commands/handlers/session/checkpoints.ts",
  "commands/handlers/session.ts",
  "commands/handlers/mcp/connector.ts",
  "commands/handlers/mcp/permissions.ts",
  "commands/handlers/mcp/task.ts",
  "commands/handlers/mcp.ts",
  "commands/handlers/model.ts",
  "commands/registry.helpers.ts",
  "commands/builtins.ts",
  "commands/registry.ts",
  "headless/shared.ts",
  "headless/ask.output.helpers.ts",
  "headless/ask.helpers.ts",
  "headless/download.helpers.ts",
  "headless/download.ts",
  "headless/login.ts",
  "headless/stop.ts",
  "run-tui.ts",
];

const PUBLIC_CLASS_METHODS = [
  "runDefault",
  "runAsk",
  "runLogin",
  "runStop",
  "runSessions",
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.name.endsWith(".ts") && !SKIP.has(entry.name)) files.push(path);
  }
  return files.sort();
}

function stripImports(text) {
  let out = text.replace(/^import\s+type\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^import\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^import\s+.*?from\s+.*?;\s*$/gm, "");
  return out;
}

function transformModuleBody(text) {
  let out = text;
  out = out.replace(/^export\s+type\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^export\s+\{[\s\S]*?\}\s+from\s+.*?;\s*$/gm, "");
  out = out.replace(/^export\s+type\s+/gm, "type ");
  out = out.replace(/^export\s+interface\s+/gm, "interface ");
  out = out.replace(/^export\s+class\s+/gm, "class ");
  out = out.replace(/^export\s+const\s+/gm, "const ");
  out = out.replace(/^export\s+async\s+function\s+/gm, "async function ");
  out = out.replace(/^export\s+function\s+/gm, "function ");
  out = out.replace(/^export\s+\{[\s\S]*?\}\s*;?\s*$/gm, "");
  return out;
}

function orderFiles(files) {
  const byRel = new Map(files.map((f) => [relative(TERMINAL_DIR, f), f]));
  const ordered = [];
  for (const rel of FILE_ORDER) {
    if (byRel.has(rel)) ordered.push(byRel.get(rel));
  }
  for (const [rel, path] of byRel) {
    if (!FILE_ORDER.includes(rel)) ordered.push(path);
  }
  return ordered;
}

const dirFiles = orderFiles([
  ...MERGE_DIRS.flatMap((sub) => []),
  ...(await walk(join(TERMINAL_DIR, "commands"))),
  ...(await walk(join(TERMINAL_DIR, "headless"))),
  ...MERGE_FILES.map((name) => join(TERMINAL_DIR, name)),
]);

const chunks = [];
for (const file of dirFiles) {
  const rel = relative(TERMINAL_DIR, file);
  let body = transformModuleBody(stripImports(await readFile(file, "utf8")));
  if (!body.trim()) continue;
  chunks.push(`// --- ${rel} ---\n${body}`);
}

const header = `import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { render } from "ink";
import type { Page } from "playwright";
import React from "react";
import type {
  Attachment,
  CommandContext,
  CommandDef,
  ConnectorSetupResult,
  Message,
} from "../domain/types.ts";
import { findModelProfile, listModelProfiles } from "../domain/models.config.ts";
import { normalizePermissionMode, PERMISSION_MODES } from "../domain/permissions.ts";
import { startEngine } from "../bridge/create-engine.factory.ts";
import { BridgeEngine } from "../bridge/bridge-engine.class.ts";
import { extractAllMessages, loadManifest } from "../providers/chatgpt/attachments/extract-messages.ts";
import { downloadAll } from "../providers/chatgpt/attachments/download-attachment.ts";
import { BRIDGE_DEBUG_PORT, BrowserManager } from "../providers/chrome/browser-manager.ts";
import {
  getBrowserProvider,
  normalizeProvider,
} from "../providers/create-provider.factory.ts";
import { listCheckpoints, restoreCheckpoint } from "../store/checkpoints.ts";
import { bridgeLogPath } from "../store/logging.ts";
import { exportsDir, screenshotsDir, sessionsDir } from "../store/paths.ts";
import {
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  type SessionExport,
  type SessionStoreOptions,
} from "../store/session-store.ts";
import type { SessionMetadata } from "../store/session-store.ts";
import { ensureInsideRepo, trimOutput, toolRegistry } from "../tools/server.ts";
import { loadCustomCommands, loadProjectInstructions, renderCustomCommandPrompt } from "../user-config/hooks.ts";
import type {
  AskOptions,
  CommonCliOptions,
  DownloadCmdOptions,
  DownloadResult,
  LoginOptions,
} from "./cli-types.ts";
import { getProviderDisplayName } from "./provider-label.ts";
import { BridgeApp } from "./tui/App.tsx";

`;

let mergedBody = chunks.join("\n\n");
// split-args.ts and files.format.ts both define splitArgs — keep files.format version.
mergedBody = mergedBody.replace(
  /\/\/ --- commands\/handlers\/helpers\/split-args\.ts ---[\s\S]*?(?=\/\/ ---)/,
  "",
);
// Duplicate conversationIdFromPage in download.ts — rename download copy.
mergedBody = mergedBody.replace(
  /\/\/ --- headless\/download\.ts ---/,
  "// --- headless/download.ts ---",
);
mergedBody = mergedBody.replace(
  /(\/\/ --- headless\/download\.ts ---[\s\S]*?)function conversationIdFromPage\(/g,
  "$1function downloadConversationIdFromPage(",
);
mergedBody = mergedBody.replace(
  /conversationId: options\.conversation ?? conversationIdFromPage\(page\)/,
  "conversationId: options.conversation ?? downloadConversationIdFromPage(page)",
);

mergedBody = mergedBody.replace(/\basync function runLogin\(/g, "async function runLoginCmd(");
mergedBody = mergedBody.replace(/\basync function runStop\(/g, "async function runStopCmd(");
mergedBody = mergedBody.replace(/\basync function runSessions\(/g, "async function runSessionsCmd(");
mergedBody = mergedBody.replace(/\basync function runDownload\(/g, "async function runDownloadCmd(");
mergedBody = mergedBody.replace(
  /interface LoginOptions \{\s*repo\?: string;\s*provider\?: string;\s*\}\s*\n/,
  "",
);
mergedBody = mergedBody.replace(/interface DownloadResult \{[\s\S]*?error\?: string;\s*\}\s*\n/, "");

// Adapt to BridgeEngine public API
mergedBody = mergedBody.replace(/\binput\.engine\.orchestrator\b/g, "input.engine.getOrchestrator()");
mergedBody = mergedBody.replace(/\bengine\.orchestrator\b/g, "engine.getOrchestrator()");
mergedBody = mergedBody.replace(/\bengine\.getSessionId\(\)/g, "engine.sessionId");
mergedBody = mergedBody.replace(/\bengine\.abort\(\)/g, "engine.getOrchestrator().stopResponse()");
mergedBody = mergedBody.replace(
  /permission: \{ getMode: input\.engine\.getPermissionMode, setMode: input\.engine\.setPermissionMode \}/g,
  "permission: { getMode: () => input.engine.permissionMode, setMode: (mode) => { input.engine.permissionMode = mode; } }",
);
mergedBody = mergedBody.replace(
  /engine: \{ abort\(\): Promise<void>; shutdown\(opts\?: \{ closeBrowser\?: boolean \}\): Promise<void> \}/g,
  "engine: BridgeEngine",
);
mergedBody = mergedBody.replace(
  /session: \{ getId: input\.engine\.getSessionId, setId: input\.engine\.setSessionId \}/g,
  "session: { getId: () => input.engine.sessionId, setId: (id) => { input.engine.sessionId = id; } }",
);

const fixedClassMethods = PUBLIC_CLASS_METHODS.map((name) => {
  if (name === "runDefault") {
    return `  /** Launch the interactive Ink TUI (default \`bridge\` action). */\n  async runDefault(opts: CommonCliOptions & { browser?: boolean }): Promise<void> {\n    await runTui(opts);\n  }`;
  }
  if (name === "runAsk") {
    return `  /** Send one prompt and print the reply (non-interactive \`bridge ask\`). */\n  async runAsk(prompt: string, options: AskOptions): Promise<void> {\n    await runAskFlow({ prompt, options: options ?? {} });\n  }`;
  }
  if (name === "runLogin") {
    return `  /** Open the bridge Chrome profile to sign in once. */\n  async runLogin(options: LoginOptions = {}): Promise<void> {\n    await runLoginCmd(options);\n  }`;
  }
  if (name === "runStop") {
    return `  /** Close the warm bridge browser. */\n  async runStop(): Promise<void> {\n    await runStopCmd();\n  }`;
  }
  return `  /** List stored bridge sessions as JSON. */\n  async runSessions(): Promise<void> {\n    await runSessionsCmd();\n  }`;
}).join("\n\n");

const reExports = `
// --- module re-exports for TUI, tests, register-cli ---

export type { AskOptions, DownloadCmdOptions, DownloadResult, LoginOptions };

/** Send one prompt and print the reply, leaving the browser warm. */
export async function runAsk(prompt: string, options: AskOptions): Promise<void> {
  const runner = new CliRunner();
  await runner.runAsk(prompt, options);
}

/** Download a conversation's attachments to disk without the TUI. */
export async function runDownload(options: DownloadCmdOptions): Promise<void> {
  await runDownloadCmd(options);
}

export { parseAttachmentIds, formatDownloadLine };

/** Open the isolated Chrome profile so the user can sign in once. */
export async function runLogin(options: LoginOptions = {}): Promise<void> {
  const runner = new CliRunner();
  await runner.runLogin(options);
}

/** Close the warm Chrome instance holding the debug port. */
export async function runStop(): Promise<void> {
  const runner = new CliRunner();
  await runner.runStop();
}

export { abortAndExit, timeoutMsFromSeconds };

/** Print stored bridge sessions (newest first) as JSON. */
export async function runSessions(): Promise<void> {
  const runner = new CliRunner();
  await runner.runSessions();
}

export {
  executeCommand,
  getAllCommands,
  matchCommands,
  parseCommand,
  registerCommand,
};

export {
  buildProjectTaskPrompt,
  buildProjectTaskPromptWithInstructions,
};

export {
  formatSessionSummary,
  mcpConnectorUrl,
  formatBridgeStatus,
  formatMcpDiagnostics,
  formatConnectorSetupResult,
};
`;

const classBlock = `
/** Terminal CLI runner: interactive TUI and headless subcommands. */
export class CliRunner {
${fixedClassMethods}
}
`;

const output = header + mergedBody + classBlock + reExports;
await writeFile(OUT, output);
console.log(`Wrote ${OUT} (${output.split("\n").length} lines) from ${dirFiles.length} files`);
