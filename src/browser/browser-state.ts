import {
  type MyChromeDebugTarget,
  readBridgeChromeProfileRoot,
  readConfiguredBrowserChoice,
  readMyChromeDebugTarget,
  readMyChromeProfileRoot,
} from "./browser-profile.ts";
import type { BrowserChoice, BrowserStatus } from "./browser-schemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  getUserProfileDirectoryOnDebugPort,
  isChromeProcessRunning,
  isDebugPortListening,
} from "./browser-session.ts";

const CHROME_NOT_RUNNING_STATUS = "chrome-not-running";

const CHROME_RUNNING_WITHOUT_DEBUG_STATUS = "chrome-running-without-debug";

const BROWSER_READY_STATUS = "ready";

type BrowserStatusCollaborators = {
  readonly bridgeChromeProfileRoot?: () => string;
  readonly getUserDataDirOnDebugPort?: (port?: number) => Promise<string | null>;
  readonly isChromeProcessRunning?: () => Promise<boolean>;
  readonly isDebugPortListening?: (details?: { port?: number }) => Promise<boolean>;
  readonly myChromeDebugTarget?: () => MyChromeDebugTarget | null;
};

type BrowserStatusDetails = {
  readonly port?: number;
  readonly profileRoot?: string | null;
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

  const checkDebugPort = collaborators.isDebugPortListening ?? isDebugPortListening;
  const checkChromeProcess = collaborators.isChromeProcessRunning ?? isChromeProcessRunning;
  const readUserProfileDirectory =
    collaborators.getUserDataDirOnDebugPort ?? getUserProfileDirectoryOnDebugPort;
  const readDefaultBridgeProfileRoot =
    collaborators.bridgeChromeProfileRoot ?? readBridgeChromeProfileRoot;
  const bridgeProfileRoot = details.profileRoot ?? readDefaultBridgeProfileRoot();

  const readDebugTarget = collaborators.myChromeDebugTarget ?? readMyChromeDebugTarget;

  const chromeRunning = await checkChromeProcess();

  const isMyChromeChosen = readBrowserChoice(details) === "my-chrome";
  if (isMyChromeChosen) {
    return readMyChromeStatus({
      chromeRunning,
      debugTarget: readDebugTarget(),
      bridgeProfileRoot,
    });
  }

  const debugPortListening = await checkDebugPort({ port });
  const userProfileDirectory = await readUserProfileDirectoryIfListening(
    readUserProfileDirectory,
    port,
    debugPortListening,
  );
  return pickBrowserStatus({
    port,
    debugPortListening,
    chromeRunning,
    userDataDir: userProfileDirectory,
    bridgeProfileRoot,
  });
};

const readUserProfileDirectoryIfListening = async (
  readUserProfileDirectory: (port: number) => Promise<string | null>,
  port: number,
  isDebugPortOpen: boolean,
): Promise<string | null> => {
  if (isDebugPortOpen) return readUserProfileDirectory(port);

  return null;
};

const pickBrowserStatus = (details: {
  readonly port: number;
  readonly debugPortListening: boolean;
  readonly chromeRunning: boolean;
  readonly userDataDir: string | null;
  readonly bridgeProfileRoot: string;
}): BrowserStatus => {
  const isDebugPortOpen = details.debugPortListening;
  if (isDebugPortOpen) {
    return {
      ...details,
      canAttach: true,
      state: BROWSER_READY_STATUS,
      message: writeReadyMessage(details.port, details.userDataDir),
    };
  }

  const isChromeRunning = details.chromeRunning;
  if (isChromeRunning) {
    return {
      ...details,
      canAttach: false,
      state: CHROME_RUNNING_WITHOUT_DEBUG_STATUS,
      message: `Chrome is running without debug port ${details.port}. Run \`bridge chrome start\` to launch or reuse the shared bridge profile on the debug port.`,
    };
  }

  return {
    ...details,
    canAttach: false,
    state: CHROME_NOT_RUNNING_STATUS,
    message: "Chrome is not running. Start the shared bridge profile with `bridge chrome start`.",
  };
};

const readMyChromeStatus = (details: {
  readonly chromeRunning: boolean;
  readonly debugTarget: MyChromeDebugTarget | null;
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
      state: CHROME_NOT_RUNNING_STATUS,
      message:
        "Chrome is not running. Open your Chrome and turn on remote debugging at chrome://inspect/#remote-debugging.",
    };
  }

  const isDebugTargetMissing = details.debugTarget == null;
  if (isDebugTargetMissing) {
    return {
      ...myChrome,
      state: CHROME_RUNNING_WITHOUT_DEBUG_STATUS,
      message:
        "Remote debugging is off in your Chrome. Turn it on at chrome://inspect/#remote-debugging.",
    };
  }

  return {
    ...myChrome,
    port: details.debugTarget.port,
    debugPortListening: true,
    canAttach: true,
    state: BROWSER_READY_STATUS,
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
