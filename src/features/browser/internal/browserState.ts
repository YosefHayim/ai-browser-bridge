import type { BrowserStatus } from "../browserSchemas.ts";
import {
  BRIDGE_DEBUG_PORT,
  getUserDataDirOnDebugPort,
  isChromeProcessRunning,
  isDebugPortListening,
} from "./browserManager.ts";
import { bridgeChromeProfileRoot } from "./browserProfile.ts";

interface BrowserStatusDeps {
  bridgeChromeProfileRoot?: () => string;
  getUserDataDirOnDebugPort?: (port?: number) => Promise<string | null>;
  isChromeProcessRunning?: () => Promise<boolean>;
  isDebugPortListening?: (input?: { port?: number } | number) => Promise<boolean>;
}

/**
 * Read the local Chrome/debug-port state without opening a browser.
 *
 * @param input - Input values for the operation.
 * @param deps - Dependencies supplied by the caller.
 * @returns The `readBrowserStatus` result.
 * @example
 * ```ts
 * const result = await readBrowserStatus(input, deps);
 * ```
 */
export const readBrowserStatus = async (
  input: { port?: number } = {},
  deps: BrowserStatusDeps = {},
): Promise<BrowserStatus> => {
  const port = input.port ?? BRIDGE_DEBUG_PORT;
  const checkDebugPort = deps.isDebugPortListening ?? isDebugPortListening;
  const checkChromeProcess = deps.isChromeProcessRunning ?? isChromeProcessRunning;
  const readUserDataDir = deps.getUserDataDirOnDebugPort ?? getUserDataDirOnDebugPort;
  const readBridgeProfileRoot = deps.bridgeChromeProfileRoot ?? bridgeChromeProfileRoot;
  const debugPortListening = await checkDebugPort({ port });
  const chromeRunning = await checkChromeProcess();
  const userDataDir = debugPortListening ? await readUserDataDir(port) : null;
  return buildBrowserStatus({
    port,
    debugPortListening,
    chromeRunning,
    userDataDir,
    bridgeProfileRoot: readBridgeProfileRoot(),
  });
};

const buildBrowserStatus = (input: {
  port: number;
  debugPortListening: boolean;
  chromeRunning: boolean;
  userDataDir: string | null;
  bridgeProfileRoot: string;
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
  const profile = userDataDir ? ` Profile: ${userDataDir}.` : "";
  return `Chrome debug port ${port} is ready.${profile}`;
};
