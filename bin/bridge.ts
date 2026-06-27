#!/usr/bin/env node
import { Command } from "commander";
import { render } from "ink";
import { resolve } from "node:path";
import React from "react";
import { BridgeApp } from "../src/cli/app.tsx";
import { startEngine } from "../src/core/engine.ts";
import { runAsk, runSessions, runLogin, runStop } from "../src/cli/headless.ts";
import type { Message } from "../src/types/types.ts";

/** Launch the interactive Ink TUI on top of a shared engine. */
async function runTui(opts: { repo?: string; port?: string; browser?: boolean }): Promise<void> {
  console.log("\nStarting chatgpt-local-bridge...");
  const engine = await startEngine({
    repoPath: opts.repo ? resolve(opts.repo) : undefined,
    mcpPort: opts.port ? Number(opts.port) : undefined,
    withBrowser: opts.browser !== false,
    withTools: true,
    log: (line) => console.error(line),
  });

  // TUI display model. This listener only maintains the on-screen message list;
  // persistence and context counting live in the engine's own listener.
  const messages: Message[] = [];
  engine.orchestrator.on((event) => {
    if (event.type === "message") messages.push(event.message);
    if (event.type === "conversation_synced") {
      messages.length = 0;
      messages.push(...event.messages);
    }
    if (event.type === "reset") messages.length = 0;
  });

  const shutdown = async (code = 0): Promise<void> => {
    await engine.shutdown({ closeBrowser: false });
    process.exit(code);
  };
  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));

  render(
    React.createElement(BridgeApp, {
      config: engine.config,
      sendMessage: async (content: string) => {
        await engine.ask(content);
      },
      clearMessages: () => {
        messages.length = 0;
      },
      shutdown: () => shutdown(0),
      messages,
      counter: engine.counter,
      orchestrator: engine.orchestrator,
      permission: { getMode: engine.getPermissionMode, setMode: engine.setPermissionMode },
      session: { getId: engine.getSessionId, setId: engine.setSessionId },
      statusline: { branch: engine.branch, toolCallCount: () => engine.toolActions.length },
    }),
  );
}

const program = new Command();

program
  .name("bridge")
  .description("Terminal CLI that bridges ChatGPT with local tools via MCP")
  .version("0.1.0")
  .option("-r, --repo <path>", "Path to the target repository (default: cwd)")
  .option("-p, --port <number>", "MCP server port (default: 8765)")
  .option("--no-browser", "Skip Chrome browser connection")
  .action(runTui);

program
  .command("ask <prompt...>")
  .description("Send one prompt to ChatGPT and print the reply (non-interactive)")
  .option("-r, --repo <path>", "Target repository for MCP tools")
  .option("-p, --port <number>", "MCP server port")
  .option("--json", "Emit a JSON object { sessionId, model, reply, contextTokens }")
  .option("--tools", "Start the tunnel + connector so ChatGPT can call local tools")
  .option("--fresh", "Start a new ChatGPT conversation before asking")
  .option("--timeout <seconds>", "Max seconds to wait for ChatGPT's reply (default 300)")
  .action((promptParts: string[], options) => runAsk(promptParts.join(" "), options));

program
  .command("sessions")
  .description("List stored bridge sessions as JSON")
  .action(runSessions);

program
  .command("login")
  .description("Open the bridge Chrome profile to sign in to ChatGPT once")
  .action(runLogin);

program
  .command("stop")
  .description("Close the warm bridge browser")
  .action(runStop);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
