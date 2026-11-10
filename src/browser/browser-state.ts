import {
  type MyChromeDebugTarget,
  myChromeDebugTarget,
  readBridgeChromeProfileRoot,
  readConfiguredBrowserChoice,
  readMyChromeDataRoot,
} from "./browser-profile.ts";
import type { BrowserChoice, BrowserStatus } from "./browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  getUserDataDirOnDebugPort,
  isChromeProcessRunning,
  isDebugPortListening,
} from "./browser-session.ts";

type BrowserStatusDeps = {
  readonly bridgeChromeProfileRoot?: () => string;
  readonly getUserDataDirOnDebugPort?: (port?: number) => Promise<string | null>;
  readonly isChromeProcessRunning?: () => Promise<boolean>;
  readonly isDebugPortListening?: (input?: { port?: number }) => Promise<boolean>;
  readonly myChromeDebugTarget?: () => MyChromeDebugTarget | undefined;
};

type BrowserStatusInput = {
  readonly port?: number;
  readonly browserChoice?: BrowserChoice;
};

const readBrowserChoice = (input: BrowserStatusInput): BrowserChoice => {
  const hasBrowserChoice = input.browserChoice !== undefined;
  if (hasBrowserChoice) return input.browserChoice;

  return readConfiguredBrowserChoice();
};

export const readBrowserStatus = async (
  input: BrowserStatusInput = {},
  deps: BrowserStatusDeps = {},
): Promise<BrowserStatus> => {
  let port = BRIDGE_DEBUG_PORT;
  const hasPort = input.port !== undefined;
  if (hasPort) {
    port = input.port;
  }

  let checkDebugPort = isDebugPortListening;

  const hasIsDebugPortListening = deps.isDebugPortListening !== undefined;
  if (hasIsDebugPortListening) {
    checkDebugPort = deps.isDebugPortListening;
  }

  let checkChromeProcess = isChromeProcessRunning;

  const hasIsChromeProcessRunning = deps.isChromeProcessRunning !== undefined;
  if (hasIsChromeProcessRunning) {
    checkChromeProcess = deps.isChromeProcessRunning;
  }

  let readUserDataDir = getUserDataDirOnDebugPort;

  const hasGetUserDirOnDebugPort = deps.getUserDataDirOnDebugPort !== undefined;
  if (hasGetUserDirOnDebugPort) {
    readUserDataDir = deps.getUserDataDirOnDebugPort;
  }

  let readBridgeProfileRoot = readBridgeChromeProfileRoot;

  const hasBridgeChromeProfileRoot = deps.bridgeChromeProfileRoot !== undefined;
  if (hasBridgeChromeProfileRoot) {
    readBridgeProfileRoot = deps.bridgeChromeProfileRoot;
  }

  let readMyChromeDebugTarget = (): MyChromeDebugTarget | undefined => myChromeDebugTarget();

  const hasMyChromeDebugTarget = deps.myChromeDebugTarget !== undefined;
  if (hasMyChromeDebugTarget) {
    readMyChromeDebugTarget = deps.myChromeDebugTarget;
  }

  const chromeRunning = await checkChromeProcess();

  const isMyChromeChosen = readBrowserChoice(input) === "my-chrome";
  if (isMyChromeChosen) {
    return readMyChromeStatus({
      chromeRunning,
      debugTarget: readMyChromeDebugTarget(),
      bridgeProfileRoot: readBridgeProfileRoot(),
    });
  }

  const debugPortListening = await checkDebugPort({ port });
  const userDataDir = debugPortListening ? await readUserDataDir(port) : null;
  return browserStatusFor({
    port,
    debugPortListening,
    chromeRunning,
    userDataDir,
    bridgeProfileRoot: readBridgeProfileRoot(),
  });
};

const browserStatusFor = (input: {
  readonly port: number;
  readonly debugPortListening: boolean;
  readonly chromeRunning: boolean;
  readonly userDataDir: string | null;
  readonly bridgeProfileRoot: string;
}): BrowserStatus => {
  if (input.debugPortListening) {
    return {
      ...input,
      canAttach: true,
      state: "ready",
      message: writeReadyMessage(input.port, input.userDataDir),
    };
  }

  if (input.chromeRunning) {
    return {
      ...input,
      canAttach: false,
      state: "chrome-running-without-debug",
      message: `Chrome is running without debug port ${input.port}. Run \`bridge chrome start\` to launch or reuse the shared bridge profile on the debug port.`,
    };
  }

  return {
    ...input,
    canAttach: false,
    state: "chrome-not-running",
    message: "Chrome is not running. Start the shared bridge profile with `bridge chrome start`.",
  };
};

const readMyChromeStatus = (input: {
  readonly chromeRunning: boolean;
  readonly debugTarget: MyChromeDebugTarget | undefined;
  readonly bridgeProfileRoot: string;
}): BrowserStatus => {
  const myChrome = {
    port: BRIDGE_DEBUG_PORT,
    debugPortListening: false,
    chromeRunning: input.chromeRunning,
    userDataDir: readMyChromeDataRoot(),
    bridgeProfileRoot: input.bridgeProfileRoot,
    canAttach: false,
  };

  const isNotChromeRunning = !input.chromeRunning;
  if (isNotChromeRunning) {
    return {
      ...myChrome,
      state: "chrome-not-running",
      message:
        "Chrome is not running. Open your Chrome and turn on remote debugging at chrome://inspect/#remote-debugging.",
    };
  }

  const isDebugTargetMissing = input.debugTarget === undefined;
  if (isDebugTargetMissing) {
    return {
      ...myChrome,
      state: "chrome-running-without-debug",
      message:
        "Remote debugging is off in your Chrome. Turn it on at chrome://inspect/#remote-debugging.",
    };
  }

  return {
    ...myChrome,
    port: input.debugTarget.port,
    debugPortListening: true,
    canAttach: true,
    state: "ready",
    message: `Your Chrome has remote debugging on at port ${input.debugTarget.port}. Click Allow in Chrome when a command connects.`,
  };
};

const writeReadyMessage = (port: number, userDataDir: string | null): string => {
  const isUserDirMissing = userDataDir === null;
  if (isUserDirMissing) {
    return `Chrome debug port ${port} is ready.`;
  }

  return `Chrome debug port ${port} is ready. Profile: ${userDataDir}.`;
};
