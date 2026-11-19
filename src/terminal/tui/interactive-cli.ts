import { render } from "ink";
import React from "react";
import { startEngine } from "@/bridge-engine/bridge-engine.ts";
import type { Message } from "@/message-types.ts";
import { readProviderIdFrom } from "@/providers/providers.ts";
import { failUsage } from "@/terminal/cli/cli-failure.ts";
import { readAbsolutePathFromOption } from "@/terminal/cli/cli-option-readers.ts";
import type { BrowserTargetSettings, CliSettings } from "@/terminal/cli/cli-types.ts";
import { CHATGPT_PROVIDER_ID } from "@/terminal/cli/engine-session.ts";
import { readProviderDisplayName } from "@/terminal/cli/provider-label.ts";
import { addStopOnInterrupt } from "@/terminal/cli/user-interrupt.ts";
import { stopEngine } from "@/terminal/commands/engine-commands.ts";
import { BridgeApp } from "@/terminal/tui/shell/app.tsx";

type TuiSettings = CliSettings & BrowserTargetSettings & { browser?: boolean };

async function runTui(settings: TuiSettings): Promise<void> {
  const isThereNoTerminal = !process.stdout.isTTY;
  if (isThereNoTerminal) {
    failUsage(
      "bridge: the interactive TUI needs a TTY. Use `bridge ask <prompt>` for non-interactive or piped use.",
    );
  }

  const provider = readProviderIdFrom(settings.provider);
  const label = readProviderDisplayName(provider);
  console.log(`\nStarting ai-browser-bridge (${label})...`);
  const engine = await startEngine({
    repoPath: readAbsolutePathFromOption(settings.repo),
    profileRoot: readAbsolutePathFromOption(settings.profile),
    provider,
    mcpPort: settings.port,
    debugPort: settings.debugPort,
    withBrowser: settings.browser !== false,
    withTools: provider === CHATGPT_PROVIDER_ID,
    log: (line) => console.error(line),
  });
  await showTui(engine);
}

async function showTui(engine: Awaited<ReturnType<typeof startEngine>>): Promise<void> {
  const messages: Message[] = [];
  attachOrchestratorListener({ engine, messages });
  addStopOnInterrupt(() => stopEngine(engine));
  const app = startBridgeApp({ engine, messages, shutdown: () => shutDownTui(engine, app) });
  await app.waitUntilExit();
}

function attachOrchestratorListener(details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
}): void {
  details.engine.getOrchestrator().subscribe((event) => {
    const isEventTypeMessage = event.type === "message";
    if (isEventTypeMessage) details.messages.push(event.message);

    const isEventTypeConversationSynced = event.type === "conversation_synced";
    if (isEventTypeConversationSynced) {
      details.messages.length = 0;
      details.messages.push(...event.messages);
    }

    const isEventTypeReset = event.type === "reset";
    if (isEventTypeReset) details.messages.length = 0;

    const isEventTypeError = event.type === "error";
    if (isEventTypeError) {
      details.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠ ${event.error}`,
        timestamp: Date.now(),
      });
    }
  });
}

async function shutDownTui(
  engine: Awaited<ReturnType<typeof startEngine>>,
  app: ReturnType<typeof render>,
): Promise<void> {
  await stopEngine(engine);
  app.unmount();
}

function startBridgeApp(details: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  messages: Message[];
  shutdown: () => Promise<void>;
}): ReturnType<typeof render> {
  return render(
    React.createElement(BridgeApp, {
      bridgeSettings: details.engine.bridgeSettings,
      sendMessage: async (message: string) => {
        await details.engine.ask({ content: message });
      },
      clearMessages: () => {
        details.messages.length = 0;
      },
      shutdown: details.shutdown,
      messages: details.messages,
      counter: details.engine.counter,
      orchestrator: details.engine.getOrchestrator(),
      permission: {
        getMode: () => details.engine.permissionMode,
        setMode: (mode) => {
          details.engine.permissionMode = mode;
        },
      },
      session: {
        getId: () => details.engine.sessionId,
        setId: (id) => {
          details.engine.sessionId = id;
        },
      },
      statusline: {
        branch: details.engine.branch,
        toolCallCount: () => details.engine.toolActions.length,
      },
    }),
  );
}

export async function runInteractiveCli(settings: TuiSettings): Promise<void> {
  await runTui(settings);
}
