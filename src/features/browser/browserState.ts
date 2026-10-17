import {
  bridgeChromeProfileRoot,
  configuredBrowserChoice,
  type MyChromeDebugTarget,
  myChromeDataRoot,
  myChromeDebugTarget,
} from "./browserProfile.ts";
import type { BrowserChoice, BrowserStatus } from "./browserSchemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  getUserDataDirOnDebugPort,
  isChromeProcessRunning,
  isDebugPortListening,
} from "./browserSession.ts";

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

const browserChoiceFor = (input: BrowserStatusInput): BrowserChoice => {
  if (input.browserChoice !== undefined) return input.browserChoice;
  return configuredBrowserChoice();
};

export const readBrowserStatus = async (
  input: BrowserStatusInput = {},
  deps: BrowserStatusDeps = {},
): Promise<BrowserStatus> => {
  let port = BRIDGE_DEBUG_PORT;
  if (input.port !== undefined) {
    port = input.port;
  }

  let checkDebugPort = isDebugPortListening;
  if (deps.isDebugPortListening !== undefined) {
    checkDebugPort = deps.isDebugPortListening;
  }

  let checkChromeProcess = isChromeProcessRunning;
  if (deps.isChromeProcessRunning !== undefined) {
    checkChromeProcess = deps.isChromeProcessRunning;
  }

  let readUserDataDir = getUserDataDirOnDebugPort;
  if (deps.getUserDataDirOnDebugPort !== undefined) {
    readUserDataDir = deps.getUserDataDirOnDebugPort;
  }

  let readBridgeProfileRoot = bridgeChromeProfileRoot;
  if (deps.bridgeChromeProfileRoot !== undefined) {
    readBridgeProfileRoot = deps.bridgeChromeProfileRoot;
  }

  let readMyChromeDebugTarget = (): MyChromeDebugTarget | undefined => myChromeDebugTarget();
  if (deps.myChromeDebugTarget !== undefined) {
    readMyChromeDebugTarget = deps.myChromeDebugTarget;
  }

  const chromeRunning = await checkChromeProcess();
  if (browserChoiceFor(input) === "my-chrome") {
    return myChromeStatus({
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
      message: readyMessage(input.port, input.userDataDir),
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

const myChromeStatus = (input: {
  readonly chromeRunning: boolean;
  readonly debugTarget: MyChromeDebugTarget | undefined;
  readonly bridgeProfileRoot: string;
}): BrowserStatus => {
  const myChrome = {
    port: BRIDGE_DEBUG_PORT,
    debugPortListening: false,
    chromeRunning: input.chromeRunning,
    userDataDir: myChromeDataRoot(),
    bridgeProfileRoot: input.bridgeProfileRoot,
    canAttach: false,
  };
  if (!input.chromeRunning) {
    return {
      ...myChrome,
      state: "chrome-not-running",
      message:
        "Chrome is not running. Open your Chrome and turn on remote debugging at chrome://inspect/#remote-debugging.",
    };
  }
  if (input.debugTarget === undefined) {
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

const readyMessage = (port: number, userDataDir: string | null): string => {
  if (userDataDir === null) {
    return `Chrome debug port ${port} is ready.`;
  }
  return `Chrome debug port ${port} is ready. Profile: ${userDataDir}.`;
};
