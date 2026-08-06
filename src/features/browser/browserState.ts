import { bridgeChromeProfileRoot } from "./browserProfile.ts";
import type { BrowserStatus } from "./browserSchemas.ts";
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
};

export const readBrowserStatus = async (
  input: { readonly port?: number } = {},
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

  const debugPortListening = await checkDebugPort({ port });
  const chromeRunning = await checkChromeProcess();
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

const readyMessage = (port: number, userDataDir: string | null): string => {
  if (userDataDir === null) {
    return `Chrome debug port ${port} is ready.`;
  }
  return `Chrome debug port ${port} is ready. Profile: ${userDataDir}.`;
};
