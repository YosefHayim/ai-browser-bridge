import { render } from "ink";
import { resolve } from "node:path";
import React from "react";
import { startEngine } from "../bridge/create-engine.factory.ts";
import { normalizeProvider } from "../providers/create-provider.factory.ts";
import type { Message } from "../domain/types.ts";
import { BridgeApp } from "./tui/App.tsx";
import type { CommonCliOptions } from "./cli-types.ts";
import { getProviderDisplayName } from "./provider-label.ts";

/** Launch the interactive Ink TUI on top of a shared engine. */
export async function runTui(opts: CommonCliOptions & { browser?: boolean }): Promise<void> {
  const provider = normalizeProvider(opts.provider);
  const label = getProviderDisplayName(provider);
  console.log(`\nStarting ai-browser-bridge (${label})...`);
  const engine = await startEngine({
    repoPath: opts.repo ? resolve(opts.repo) : undefined,
    provider,
    mcpPort: opts.port ? Number(opts.port) : undefined,
    withBrowser: opts.browser !== false,
    withTools: provider === "chatgpt",
    log: (line) => console.error(line),
  });
  await renderTui(engine);
}

/** Wire engine events into the Ink app and handle shutdown signals. */
export async function renderTui(engine: Awaited<ReturnType<typeof startEngine>>): Promise<void> {
  const messages: Message[] = [];
  attachOrchestratorListener({ engine, messages });
  const shutdown = buildShutdownHandler(engine);
  registerShutdownSignals(shutdown);
  renderBridgeApp({ engine, messages, shutdown });
}

/** Mirror orchestrator message events into the TUI message list. */
function attachOrchestratorListener(input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
}): void {
  input.engine.orchestrator.on((event) => {
    if (event.type === "message") input.messages.push(event.message);
    if (event.type === "conversation_synced") {
      input.messages.length = 0;
      input.messages.push(...event.messages);
    }
    if (event.type === "reset") input.messages.length = 0;
  });
}

/** Build a shutdown handler that aborts, tears down, and exits. */
function buildShutdownHandler(engine: Awaited<ReturnType<typeof startEngine>>) {
  return async (code = 0): Promise<void> => {
    await engine.abort().catch(() => {});
    await engine.shutdown({ closeBrowser: false });
    process.exit(code);
  };
}

/** Register SIGINT/SIGTERM handlers for graceful TUI shutdown. */
function registerShutdownSignals(shutdown: (code?: number) => Promise<void>): void {
  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
}

/** Render the Ink BridgeApp with engine wiring. */
function renderBridgeApp(input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
  shutdown: (code?: number) => Promise<void>;
}): void {
  render(
    React.createElement(BridgeApp, {
      config: input.engine.config,
      sendMessage: async (content: string) => {
        await input.engine.ask({ content });
      },
      clearMessages: () => {
        input.messages.length = 0;
      },
      shutdown: () => input.shutdown(0),
      messages: input.messages,
      counter: input.engine.counter,
      orchestrator: input.engine.orchestrator,
      permission: { getMode: input.engine.getPermissionMode, setMode: input.engine.setPermissionMode },
      session: { getId: input.engine.getSessionId, setId: input.engine.setSessionId },
      statusline: { branch: input.engine.branch, toolCallCount: () => input.engine.toolActions.length },
    }),
  );
}
