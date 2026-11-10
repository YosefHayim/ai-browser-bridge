import {
  type MyChromeDebugTarget,
  myChromeDebugTarget,
  readBridgeChromeProfileRoot,
  readConfiguredBrowserChoice,
  readMyChromeProfileRoot,
} from "./browser-profile.ts";
import type { BrowserChoice, BrowserStatus } from "./browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  getUserProfileDirectoryOnDebugPort,
  isChromeProcessRunning,
  isDebugPortListening,
} from "./browser-session.ts";

type BrowserStatusCollaborators = {
  readonly bridgeChromeProfileRoot?: () => string;
  readonly getUserDataDirOnDebugPort?: (port?: number) => Promise<string | null>;
  readonly isChromeProcessRunning?: () => Promise<boolean>;
  readonly isDebugPortListening?: (details?: { port?: number }) => Promise<boolean>;
  readonly myChromeDebugTarget?: () => MyChromeDebugTarget | undefined;
};

type BrowserStatusDetails = {
  readonly port?: number;
  readonly browserChoice?: BrowserChoice;
};

const readBrowserChoice = (details: BrowserStatusDetails): BrowserChoice => {
  const hasBrowserChoice = details.browserChoice != null;
  if (hasBrowserChoice) return details.browserChoice;

  return readConfiguredBrowserChoice();
};

export const readBrowserStatus = async (
  details: BrowserStatusDetails = {},
  collaborators: BrowserStatusCollaborators = {},
): Promise<BrowserStatus> => {
  let port = BRIDGE_DEBUG_PORT;
  const hasPort = details.port != null;
  if (hasPort) {
    port = details.port;
  }

  let checkDebugPort = isDebugPortListening;

  const hasIsDebugPortListening = collaborators.isDebugPortListening != null;
  if (hasIsDebugPortListening) {
    checkDebugPort = collaborators.isDebugPortListening;
  }

  let checkChromeProcess = isChromeProcessRunning;

  const hasIsChromeProcessRunning = collaborators.isChromeProcessRunning != null;
  if (hasIsChromeProcessRunning) {
    checkChromeProcess = collaborators.isChromeProcessRunning;
  }

  let readUserProfileDirectory = getUserProfileDirectoryOnDebugPort;

  const hasGetUserDirectoryOnDebugPort = collaborators.getUserDataDirOnDebugPort != null;
  if (hasGetUserDirectoryOnDebugPort) {
    readUserProfileDirectory = collaborators.getUserDataDirOnDebugPort;
  }

  let readBridgeProfileRoot = readBridgeChromeProfileRoot;

  const hasBridgeChromeProfileRoot = collaborators.bridgeChromeProfileRoot != null;
  if (hasBridgeChromeProfileRoot) {
    readBridgeProfileRoot = collaborators.bridgeChromeProfileRoot;
  }

  let readMyChromeDebugTarget = (): MyChromeDebugTarget | undefined => myChromeDebugTarget();

  const hasMyChromeDebugTarget = collaborators.myChromeDebugTarget != null;
  if (hasMyChromeDebugTarget) {
    readMyChromeDebugTarget = collaborators.myChromeDebugTarget;
  }

  const chromeRunning = await checkChromeProcess();

  const isMyChromeChosen = readBrowserChoice(details) === "my-chrome";
  if (isMyChromeChosen) {
    return readMyChromeStatus({
      chromeRunning,
      debugTarget: readMyChromeDebugTarget(),
      bridgeProfileRoot: readBridgeProfileRoot(),
    });
  }

  const debugPortListening = await checkDebugPort({ port });
  const userProfileDirectory = debugPortListening ? await readUserProfileDirectory(port) : null;
  return browserStatusFor({
    port,
    debugPortListening,
    chromeRunning,
    userDataDir: userProfileDirectory,
    bridgeProfileRoot: readBridgeProfileRoot(),
  });
};

const browserStatusFor = (details: {
  readonly port: number;
  readonly debugPortListening: boolean;
  readonly chromeRunning: boolean;
  readonly userDataDir: string | null;
  readonly bridgeProfileRoot: string;
}): BrowserStatus => {
  if (details.debugPortListening) {
    return {
      ...details,
      canAttach: true,
      state: "ready",
      message: writeReadyMessage(details.port, details.userDataDir),
    };
  }

  if (details.chromeRunning) {
    return {
      ...details,
      canAttach: false,
      state: "chrome-running-without-debug",
      message: `Chrome is running without debug port ${details.port}. Run \`bridge chrome start\` to launch or reuse the shared bridge profile on the debug port.`,
    };
  }

  return {
    ...details,
    canAttach: false,
    state: "chrome-not-running",
    message: "Chrome is not running. Start the shared bridge profile with `bridge chrome start`.",
  };
};

const readMyChromeStatus = (details: {
  readonly chromeRunning: boolean;
  readonly debugTarget: MyChromeDebugTarget | undefined;
  readonly bridgeProfileRoot: string;
}): BrowserStatus => {
  const myChrome = {
    port: BRIDGE_DEBUG_PORT,
    debugPortListening: false,
    chromeRunning: details.chromeRunning,
    userDataDir: readMyChromeProfileRoot(),
    bridgeProfileRoot: details.bridgeProfileRoot,
    canAttach: false,
  };

  const isNotChromeRunning = !details.chromeRunning;
  if (isNotChromeRunning) {
    return {
      ...myChrome,
      state: "chrome-not-running",
      message:
        "Chrome is not running. Open your Chrome and turn on remote debugging at chrome://inspect/#remote-debugging.",
    };
  }

  const isDebugTargetMissing = details.debugTarget == null;
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
    port: details.debugTarget.port,
    debugPortListening: true,
    canAttach: true,
    state: "ready",
    message: `Your Chrome has remote debugging on at port ${details.debugTarget.port}. Click Allow in Chrome when a command connects.`,
  };
};

const writeReadyMessage = (port: number, userProfileDirectory: string | null): string => {
  const isUserDirectoryMissing = userProfileDirectory == null;
  if (isUserDirectoryMissing) {
    return `Chrome debug port ${port} is ready.`;
  }

  return `Chrome debug port ${port} is ready. Profile: ${userProfileDirectory}.`;
};
