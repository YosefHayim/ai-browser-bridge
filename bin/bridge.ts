#!/usr/bin/env node
import { Command } from "commander";
import inquirer from "inquirer";
import { render } from "ink";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import React from "react";
import { BridgeApp } from "../src/cli/app.tsx";
import { loadConfig, saveConfig } from "../src/core/config.ts";
import { Orchestrator } from "../src/core/orchestrator.ts";
import { ContextCounter } from "../src/core/context-counter.ts";
import { resolveFileMentions } from "../src/core/file-resolver.ts";
import { appendBridgeLog, bridgeLogPath } from "../src/core/logging.ts";
import { appendSessionEvent, createSession, updateSession } from "../src/core/session-store.ts";
import { normalizePermissionMode, type PermissionMode } from "../src/core/permissions.ts";
import { loadHooksConfig, runHooks } from "../src/core/hooks.ts";
import { startMcpServer, type McpToolAction } from "../src/mcp/server.ts";
import { CloudflareTunnel } from "../src/tunnel/cloudflare.ts";
import { BrowserManager } from "../src/browser/manager.ts";
import { detectChromeProfiles, profileLabel, CHROME_ROOT } from "../src/browser/profiles.ts";
import type { Message } from "../src/types/types.ts";

const DEFAULT_PORT = 8765;

/** Parse a stored browserProfilePath back into chromeRoot + profileDirName. */
function parseProfilePath(stored: string): { chromeRoot: string; profileDirName: string } {
  const normalized = resolve(stored.replace("~", process.env.HOME ?? ""));
  if (normalized.startsWith(CHROME_ROOT + "/")) {
    return { chromeRoot: CHROME_ROOT, profileDirName: normalized.slice(CHROME_ROOT.length + 1) };
  }
  if (normalized === CHROME_ROOT) {
    return { chromeRoot: CHROME_ROOT, profileDirName: "Default" };
  }
  const lastSlash = normalized.lastIndexOf("/");
  return { chromeRoot: normalized.slice(0, lastSlash), profileDirName: normalized.slice(lastSlash + 1) };
}

interface ProfilePickAnswers {
  profileDir: string;
}

/** Pick a Chrome profile — only shown when multiple profiles exist. */
async function pickChromeProfile(savedProfile?: string): Promise<{ chromeRoot: string; profileDirName: string } | null> {
  const profiles = detectChromeProfiles();

  if (profiles.length === 0) {
    console.warn("  No Chrome profiles found. Browser sync disabled.");
    return null;
  }

  if (profiles.length === 1) {
    console.log(`  Using Chrome profile: ${profileLabel(profiles[0])}`);
    return { chromeRoot: profiles[0].chromeRoot, profileDirName: profiles[0].dirName };
  }

  // Multiple profiles — check if saved profile still exists
  if (savedProfile) {
    const match = profiles.find((p) => p.fullPath === savedProfile);
    if (match) {
      console.log(`  Using saved Chrome profile: ${profileLabel(match)}`);
      return { chromeRoot: match.chromeRoot, profileDirName: match.dirName };
    }
  }

  const pick = await inquirer.prompt<ProfilePickAnswers>([
    {
      type: "select",
      name: "profileDir",
      message: "Select a Chrome profile:",
      choices: profiles.map((p) => ({ name: profileLabel(p), value: p.dirName })),
    },
  ]);
  const chosen = profiles.find((p) => p.dirName === pick.profileDir)!;
  return { chromeRoot: chosen.chromeRoot, profileDirName: chosen.dirName };
}

async function runBridge(opts: {
  repo?: string;
  port?: string;
  browserProfile?: string;
  browser?: boolean;
}): Promise<void> {
  const saved = await loadConfig();

  const repoPath = opts.repo ? resolve(opts.repo) : process.cwd();
  const mcpPort = opts.port ? Number(opts.port) : saved.mcpPort || DEFAULT_PORT;
  const browserEnabled = opts.browser !== false;

  let chromeRoot: string | undefined;
  let profileDirName: string | undefined;

  if (opts.browserProfile && browserEnabled) {
    const parsed = parseProfilePath(opts.browserProfile);
    chromeRoot = parsed.chromeRoot;
    profileDirName = parsed.profileDirName;
  } else if (browserEnabled) {
    const picked = await pickChromeProfile(saved.browserProfilePath);
    if (picked) {
      chromeRoot = picked.chromeRoot;
      profileDirName = picked.profileDirName;
    }
  }

  const config = await loadConfig({
    repoPath,
    mcpPort,
    browserProfilePath: chromeRoot ? `${chromeRoot}/${profileDirName}` : undefined,
    tunnelUrl: undefined,
  });
  config.permissionMode = normalizePermissionMode(config.permissionMode ?? "auto");
  await saveConfig(config);

  console.log("\nStarting chatgpt-local-bridge...");
  console.log(`  Repo:   ${config.repoPath}`);
  console.log(`  Port:   ${config.mcpPort}`);
  console.log(`  Perm:   ${config.permissionMode}`);

  const hooksConfig = await loadHooksConfig({ repoRoot: config.repoPath });
  if (hooksConfig.errors.length > 0) {
    console.warn("  Hooks: configuration warnings:");
    for (const error of hooksConfig.errors) console.warn(`    - ${error}`);
  }

  let permissionMode: PermissionMode = normalizePermissionMode(config.permissionMode);
  let activeSessionId = (await createSession({
    repoPath: config.repoPath,
    model: config.model ?? null,
    contextLimit: config.contextLimit,
    tunnelUrl: config.tunnelUrl ?? null,
  })).metadata.id;
  const toolActions: McpToolAction[] = [];
  const branch = await currentGitBranch(config.repoPath);

  await runHooks("SessionStart", hooksConfig.hooks).catch(() => []);
  const recordToolAction = async (action: McpToolAction) => {
    toolActions.push(action);
    await appendSessionEvent(activeSessionId, {
      type: "action",
      name: action.name,
      status: action.status,
      content: action.data?.error ? String(action.data.error) : undefined,
      data: action.data,
    }).catch(() => {});
  };

  const mcpServer = await startMcpServer(config.repoPath, config.mcpPort, {
    getPermissionMode: () => permissionMode,
    hooks: hooksConfig.hooks,
    onToolAction: recordToolAction,
  });
  console.log(`  MCP:    ${mcpServer.url}`);
  console.log(`  Logs:   ${bridgeLogPath()}`);
  console.log(`  Session:${activeSessionId}`);

  const orchestrator = new Orchestrator(config);
  const counter = new ContextCounter(config.contextLimit, config.model);
  const messages: Message[] = [];
  let tunnel: CloudflareTunnel | null = null;
  let didShutdown = false;

  const cleanup = () => {
    if (didShutdown) return;
    didShutdown = true;
    tunnel?.stop();
    mcpServer.close();
  };

  const shutdown = async (code = 0) => {
    console.log("Shutting down...");
    await runHooks("SessionEnd", hooksConfig.hooks).catch(() => []);
    cleanup();
    process.exit(code);
  };

  process.once("SIGINT", () => {
    shutdown(130).catch(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    shutdown(143).catch(() => process.exit(143));
  });
  process.once("exit", cleanup);

  let tunnelUrl = "";
  try {
    tunnel = new CloudflareTunnel();
    tunnelUrl = await tunnel.start(config.mcpPort);
    config.tunnelUrl = tunnelUrl;
    await updateSession(activeSessionId, { tunnelUrl }).catch(() => {});
    console.log(`  Tunnel:    ${tunnelUrl}`);
    console.log(`  Connector: ${mcpConnectorUrl(tunnelUrl)}`);
    console.log("  Connector setup: will sync automatically when the browser connects.");
  } catch {
    console.warn("  Tunnel: failed to start (cloudflared not installed?)");
    console.warn("  MCP tools will only work if ChatGPT can reach localhost directly.");
  }

  if (chromeRoot) {
    const browser = new BrowserManager();
    try {
      const page = await browser.launch(chromeRoot, profileDirName);
      orchestrator.setPage(page);
      console.log(`  Browser: connected (profile: ${profileDirName ?? "Default"})`);
      const connectorUrl = tunnelUrl ? mcpConnectorUrl(tunnelUrl) : null;
      if (connectorUrl) {
        console.log("  Connector setup: syncing ChatGPT app...");
        const connectorResult = await orchestrator.openConnectorSetup(connectorUrl, { automatic: true });
        console.log(formatStartupConnectorResult(connectorResult));
      }
    } catch (err) {
      console.warn("  Browser: failed to connect. Browser sync disabled.");
      console.warn(`  ${(err instanceof Error ? err.message : String(err))}`);
    }
  }

  orchestrator.on((event) => {
    if (event.type === "message") {
      messages.push(event.message);
      counter.add(event.message);
      appendBridgeLog({
        repoPath: config.repoPath,
        type: `chatgpt_${event.message.role}_message`,
        data: {
          content: event.message.content,
        },
      }).catch(() => {});
      appendSessionEvent(activeSessionId, {
        type: "message",
        role: event.message.role,
        content: event.message.content,
        data: { messageId: event.message.id },
      }).catch(() => {});
    }
    if (event.type === "conversation_synced") {
      messages.length = 0;
      messages.push(...event.messages);
      counter.reset();
      for (const message of event.messages) {
        counter.add(message);
      }
    }
    if (event.type === "reset") {
      messages.length = 0;
      counter.reset();
    }
    if (event.type === "model_changed") {
      counter.setModel(event.model);
      config.model = event.model;
      config.contextLimit = event.contextLimit;
      saveConfig(config).catch(() => {});
      updateSession(activeSessionId, {
        model: event.model,
        contextLimit: event.contextLimit,
      }).catch(() => {});
    }
  });

  await orchestrator.start();

  const sendMessage = async (content: string) => {
    await runHooks("UserPromptSubmit", hooksConfig.hooks).catch(() => []);
    const resolved = await resolveFileMentions(content, config.repoPath);
    if (resolved.files.length > 0) {
      console.log(`Attached files: ${resolved.files.map((file) => `@${file.relPath}`).join(", ")}`);
    }
    await orchestrator.sendPrompt(resolved.prompt);
  };

  render(
    React.createElement(BridgeApp, {
      config,
      sendMessage,
      clearMessages: () => {
        messages.length = 0;
      },
      shutdown,
      messages,
      counter,
      orchestrator,
      permission: {
        getMode: () => permissionMode,
        setMode: (mode: PermissionMode) => {
          permissionMode = mode;
          config.permissionMode = mode;
          saveConfig(config).catch(() => {});
        },
      },
      session: {
        getId: () => activeSessionId,
        setId: (id: string) => {
          activeSessionId = id;
        },
      },
      statusline: {
        branch,
        toolCallCount: () => toolActions.length,
      },
    }),
  );
}

function mcpConnectorUrl(tunnelUrl: string): string {
  return `${tunnelUrl.replace(/\/+$/, "")}/mcp`;
}

function formatStartupConnectorResult(result: {
  completed: boolean;
  steps: string[];
  warnings: string[];
}): string {
  const status = result.completed ? "ready" : "needs attention";
  const lastStep = result.steps.at(-1);
  const firstWarning = result.warnings[0];
  const detail = firstWarning ?? lastStep ?? "No browser setup details were reported.";
  return `  Connector setup: ${status} (${detail})`;
}

async function currentGitBranch(repoPath: string): Promise<string | undefined> {
  return new Promise((resolveBranch) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }, (error, stdout) => {
      if (error) {
        resolveBranch(undefined);
        return;
      }
      resolveBranch(stdout.trim() || undefined);
    });
  });
}

const program = new Command();

program
  .name("bridge")
  .description("Terminal CLI that bridges ChatGPT with local tools via MCP")
  .version("0.1.0")
  .option("-r, --repo <path>", "Path to the target repository (default: cwd)")
  .option("-p, --port <number>", "MCP server port (default: 8765)")
  .option("-b, --browser-profile <path>", "Chrome profile path (skips picker)")
  .option("--no-browser", "Skip Chrome browser connection")
  .action(runBridge);

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
