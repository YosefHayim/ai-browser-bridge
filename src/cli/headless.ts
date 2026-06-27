import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { startEngine } from "../core/engine.ts";
import { listSessions } from "../core/session-store.ts";
import { BrowserManager, BRIDGE_DEBUG_PORT } from "../browser/manager.ts";

/**
 * Non-interactive `bridge` subcommands.
 *
 * These exist so an automated caller (Claude, a script, CI) can drive ChatGPT
 * without the Ink TUI, which requires a live TTY. Every handler keeps stdout
 * reserved for machine-readable output and routes human diagnostics to stderr,
 * then calls process.exit so the one-shot process terminates cleanly while the
 * warm Chrome instance stays alive for the next call.
 */

interface AskOptions {
  repo?: string;
  port?: string;
  /** Start a fresh ChatGPT conversation before sending. */
  fresh?: boolean;
  /** Bring up the tunnel + connector so ChatGPT can call local MCP tools. */
  tools?: boolean;
  /** Emit a JSON object instead of plain reply text. */
  json?: boolean;
  /** Max seconds to wait for ChatGPT's reply. */
  timeout?: string;
}

/**
 * Convert a CLI `--timeout <seconds>` string to milliseconds for the engine.
 * Returns undefined for absent/empty/NaN/non-positive input so the browser
 * layer falls back to its default wait.
 */
export function timeoutMsFromSeconds(seconds: string | undefined): number | undefined {
  if (!seconds) return undefined;
  const parsed = Number(seconds);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * 1000);
}

/** Send one prompt to ChatGPT and print the reply, leaving the browser warm. */
export async function runAsk(prompt: string, options: AskOptions): Promise<void> {
  // Reserve stdout for the reply (plain text or JSON). Library diagnostics from
  // the browser/tunnel layers use console.log; route them to stderr so a caller
  // parsing stdout never sees "Connected to running Chrome…" mixed into the reply.
  console.log = (...args: unknown[]) => console.error(...args);

  const engine = await startEngine({
    repoPath: options.repo ? resolve(options.repo) : undefined,
    mcpPort: options.port ? Number(options.port) : undefined,
    withBrowser: true,
    withTools: Boolean(options.tools),
  });

  if (!engine.browser) {
    await engine.shutdown({ closeBrowser: false });
    fail("Browser not connected. Run `bridge login` once to sign in to ChatGPT.");
  }

  if (options.fresh) await engine.orchestrator.newConversation().catch(() => {});

  const timeoutMs = timeoutMsFromSeconds(options.timeout);
  const reply = await engine.ask(prompt, { timeoutMs });
  await engine.shutdown({ closeBrowser: false });

  if (!reply) {
    fail("No reply captured — ChatGPT may not be logged in, or the page UI changed. Try `bridge login`.");
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        sessionId: engine.getSessionId(),
        model: engine.orchestrator.model,
        reply: reply.content,
        contextTokens: engine.counter.count,
      })}\n`,
    );
  } else {
    process.stdout.write(`${reply.content}\n`);
  }
  process.exit(0);
}

/** Print stored bridge sessions (newest first) as JSON. */
export async function runSessions(): Promise<void> {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
  process.exit(0);
}

/**
 * Open the isolated Chrome profile at chatgpt.com so the user can sign in once.
 * The browser is left running (warm) for subsequent `bridge ask` calls.
 */
export async function runLogin(): Promise<void> {
  const browser = new BrowserManager();
  await browser.launch();
  process.stderr.write(
    "Chrome is open on the chatgpt-local-bridge profile.\n" +
      "If chatgpt.com shows a login wall, sign in now — the session persists across runs.\n" +
      "Leave this window open; `bridge ask` will reconnect to it.\n",
  );
  process.exit(0);
}

/** Close the warm Chrome instance holding the debug port. */
export async function runStop(): Promise<void> {
  const killed = await killDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n");
  process.exit(0);
}

/** Fatal error helper: write to stderr and exit non-zero. */
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Kill whatever process is listening on the Chrome debug port (macOS `lsof`). */
function killDebugPort(port: number): Promise<boolean> {
  return new Promise((resolveKill) => {
    execFile("lsof", ["-ti", `tcp:${port}`], (_err, stdout) => {
      const pids = stdout.trim().split(/\s+/).filter(Boolean);
      if (pids.length === 0) return resolveKill(false);
      for (const pid of pids) {
        try {
          process.kill(Number(pid));
        } catch {
          // process already gone
        }
      }
      resolveKill(true);
    });
  });
}
