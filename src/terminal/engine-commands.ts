import type { BridgeEngine } from "@/bridge/bridge-engine.ts";
import { readConfiguredBrowserChoice } from "@/browser/browser-profile.ts";
import type { BrowserStatus } from "@/browser/browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  BrowserSession,
  terminateChromeOnDebugPort,
} from "@/browser/browser-session.ts";
import { readBrowserStatus } from "@/browser/browser-state.ts";
import { readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { listSessions } from "@/store/session-store.ts";
import { DEBUG_PORT_FLAG, parsePortFlag, readProfileRootFromOption } from "./cli-option-readers.ts";
import { NEWLINE } from "./cli-text.ts";
import type { BrowserStatusSettings, ChromeStartSettings } from "./cli-types.ts";

const createBrowserDebugStatus = (status: BrowserStatus): string => {
  return [
    `State: ${status.state}`,
    `Chrome running: ${status.chromeRunning ? "yes" : "no"}`,
    `Debug port: ${status.debugPortListening ? "ready" : "closed"} (${status.port})`,
    `Can attach: ${status.canAttach ? "yes" : "no"}`,
    `Profile root: ${readBrowserProfileRootLabel(status)}`,
    `Message: ${status.message}`,
  ].join(NEWLINE);
};

const readBrowserProfileRootLabel = (status: BrowserStatus): string => {
  const userDataDir = status.userDataDir;
  const hasStatusUserDir = userDataDir != null;
  if (hasStatusUserDir) return userDataDir;

  return status.bridgeProfileRoot;
};

// Ctrl-C or kill: stop generating before tear-down so warm tabs do not burn quota.
export const stopEngine = async (engine: BridgeEngine): Promise<void> => {
  await Promise.allSettled([engine.getOrchestrator().stopReply()]);
  await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
};

export const runSessions = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
};

export const runBrowserStatus = async (settings: BrowserStatusSettings = {}): Promise<void> => {
  const status = await readBrowserStatus();

  if (settings.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(`${createBrowserDebugStatus(status)}\n`);
};

export const runChromeStart = async (settings: ChromeStartSettings = {}): Promise<void> => {
  const browser = await launchChromeBrowser(settings);
  await browser.closeOwnTab();
  writeChromeStartInstructions(readProvider(readProviderIdFrom(settings.provider)).displayName);
};

const launchChromeBrowser = async (settings: ChromeStartSettings): Promise<BrowserSession> => {
  const provider = readProviderIdFrom(settings.provider);
  const browser = new BrowserSession(provider, {
    debugPort: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readProfileRootFromOption(settings.profile),
  });

  await browser.launch();

  return browser;
};

const writeChromeStartInstructions = (displayName: string): void => {
  const isMyChromeChosen = readConfiguredBrowserChoice() === "my-chrome";
  if (isMyChromeChosen) {
    process.stderr.write(
      `Connected to your own Chrome for ${displayName}.
Each command opens its own tab there and closes it when done. Click Allow when Chrome asks.
`,
    );
    return;
  }

  process.stderr.write(
    `Chrome is open for ${displayName} with the bridge debug port.
This uses the shared bridge Chrome profile, so sign in once in this window and every repo can reuse it.
Leave this Chrome window open; \`bridge ask\` will reconnect to it.
`,
  );
};

export const runStop = async (): Promise<void> => {
  const killed = await terminateChromeOnDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(
    killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n",
  );
};
