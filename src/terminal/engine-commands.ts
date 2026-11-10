import type { BridgeEngine } from "@/bridge/bridge-engine.ts";
import {
  readBridgeChromeProfileRoot,
  readConfiguredBrowserChoice,
} from "@/browser/browser-profile.ts";
import type { BrowserStatus } from "@/browser/browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  BrowserSession,
  terminateChromeOnDebugPort,
} from "@/browser/browser-session.ts";
import { readBrowserStatus } from "@/browser/browser-state.ts";
import { readProvider, readProviderIdFrom } from "@/providers/providers.ts";
import { listSessions } from "@/store/session-store.ts";
import {
  DEBUG_PORT_FLAG,
  parsePortFlag,
  readAbsolutePathFromOption,
} from "./cli-option-readers.ts";
import { NEWLINE } from "./cli-text.ts";
import type {
  BrowserStatusSettings,
  BrowserTargetSettings,
  ChromeStartSettings,
} from "./cli-types.ts";

const PRETTY_PRINT_SPACES = 2;

const NO_LABEL = "no";

const YES_LABEL = "yes";

const createBrowserDebugStatus = (status: BrowserStatus): string => {
  const isChromeRunning = status.chromeRunning;
  const isDebugPortListening = status.debugPortListening;
  return [
    `State: ${status.state}`,
    `Chrome running: ${isChromeRunning ? YES_LABEL : NO_LABEL}`,
    `Debug port: ${isDebugPortListening ? "ready" : "closed"} (${status.port})`,
    `Can attach: ${status.canAttach ? YES_LABEL : NO_LABEL}`,
    `Profile root: ${readBrowserProfileRootLabel(status)}`,
    `Message: ${status.message}`,
  ].join(NEWLINE);
};

const readBrowserProfileRootLabel = (status: BrowserStatus): string => {
  const chromeProfileFolder = status.userDataDir;

  const hasStatusUserDir = chromeProfileFolder != null;
  if (hasStatusUserDir) return chromeProfileFolder;

  return status.bridgeProfileRoot;
};

// Ctrl-C or kill: stop generating before tear-down so warm tabs do not burn quota.
export const stopEngine = async (engine: BridgeEngine): Promise<void> => {
  await Promise.allSettled([engine.getOrchestrator().stopReply()]);
  await Promise.allSettled([engine.shutDown({ closeBrowser: false })]);
};

export const runSessions = async (): Promise<void> => {
  const sessions = await listSessions();
  process.stdout.write(`${JSON.stringify(sessions, null, PRETTY_PRINT_SPACES)}\n`);
};

export const runBrowserStatus = async (settings: BrowserStatusSettings = {}): Promise<void> => {
  const status = await readBrowserStatus({
    port: parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort),
    profileRoot: readAbsolutePathFromOption(settings.profile),
  });

  const isMachineReadable = settings.json;
  if (isMachineReadable)
    process.stdout.write(`${JSON.stringify(status, null, PRETTY_PRINT_SPACES)}\n`);
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
    profileRoot: readAbsolutePathFromOption(settings.profile),
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

export const runStop = async (settings: BrowserTargetSettings = {}): Promise<void> => {
  const debugPort = parsePortFlag(DEBUG_PORT_FLAG, settings.debugPort) ?? BRIDGE_DEBUG_PORT;
  const profileRoot = readAbsolutePathFromOption(settings.profile) ?? readBridgeChromeProfileRoot();
  const isKilled = await terminateChromeOnDebugPort(debugPort, profileRoot);
  process.stderr.write(
    isKilled ? "Closed the bridge browser.\n" : "No bridge browser was running.\n",
  );
};
