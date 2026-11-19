import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { readBridgeChromeProfileRoot, readChromeAppName } from "@/browser/browser-profile.ts";
import { BRIDGE_DEBUG_PORT, waitForDebugPortClosed } from "@/browser/chrome-debug-port.ts";
import { isChromeInProcessList, listChromeProcesses } from "@/operating-system/chrome-processes.ts";
import { launchChrome } from "@/operating-system/launch-chrome.ts";
import { readOperatingSystem } from "@/operating-system/read-operating-system.ts";

// Windows quotes a profile path that has spaces: --user-data-dir="C:\\Users\\a b".
const USER_PROFILE_DIRECTORY_FLAG = /--user-data-dir=(?:"(?<quotedDir>[^"]+)"|(?<userDataDir>\S+))/;

function readUserProfileDirectory(commandLine: string): string | null {
  const flagGroups = USER_PROFILE_DIRECTORY_FLAG.exec(commandLine)?.groups;
  return flagGroups?.quotedDir ?? flagGroups?.userDataDir ?? null;
}

export async function getUserProfileDirectoryOnDebugPort(
  port: number = BRIDGE_DEBUG_PORT,
): Promise<string | null> {
  try {
    const chromeProcesses = await listChromeProcesses();
    const remoteDebuggingPortArg = `--remote-debugging-port=${port}`;
    for (const { commandLine } of chromeProcesses) {
      const isDebugPortArgMissingFromLine = !commandLine.includes(remoteDebuggingPortArg);
      if (isDebugPortArgMissingFromLine) continue;

      const userProfileDirectory = readUserProfileDirectory(commandLine);

      const isUserDirectoryMissing = userProfileDirectory == null;
      if (isUserDirectoryMissing) continue;

      return userProfileDirectory;
    }
    return null;
  } catch {
    return null;
  }
}

export function isSameProfile(expected: string, actual: string): boolean {
  function readRealPath(field: string): string {
    try {
      const absolutePath = resolve(field);
      return realpathSync(absolutePath);
    } catch {
      return resolve(field);
    }
  }

  return readRealPath(expected) === readRealPath(actual);
}

async function listBridgeChromePids(port: number, profileRoot: string): Promise<number[]> {
  const chromeProcesses = await listChromeProcesses();
  const portSwitch = new RegExp(`--remote-debugging-port=${port}( |$)`);
  const pids: number[] = [];
  for (const { pid, commandLine } of chromeProcesses) {
    const isPortSwitchMissing = !portSwitch.test(commandLine);
    if (isPortSwitchMissing) continue;

    const userProfileDirectory = readUserProfileDirectory(commandLine);

    const isProfileNotMatched =
      userProfileDirectory == null || !isSameProfile(profileRoot, userProfileDirectory);
    if (isProfileNotMatched) continue;

    pids.push(pid);
  }
  return pids;
}

// Your own Chrome can hold the bridge port; it counts as the bridge's only when run from the bridge profile.
export async function terminateChromeOnDebugPort(
  port: number = BRIDGE_DEBUG_PORT,
  profileRoot: string = readBridgeChromeProfileRoot(),
): Promise<boolean> {
  let pids: number[] = [];
  try {
    pids = await listBridgeChromePids(port, profileRoot);
  } catch {
    return false;
  }

  const isPidsEmpty = pids.length === 0;
  if (isPidsEmpty) return false;

  for (const pid of pids) process.kill(pid);

  const closed = await waitForDebugPortClosed(port);

  const isNotClosed = !closed;
  if (isNotClosed) {
    throw new Error(`Asked the bridge Chrome to quit, but debug port ${port} is still open.`);
  }

  return true;
}

export async function isChromeProcessRunning(
  details: { readonly appName?: string } = {},
): Promise<boolean> {
  let appName = readChromeAppName();

  const hasAppName = details.appName != null;
  if (hasAppName) {
    appName = details.appName;
  }

  const operatingSystem = readOperatingSystem();
  try {
    const chromeProcesses = await listChromeProcesses(operatingSystem);
    return isChromeInProcessList({ chromeProcesses, operatingSystem, macosAppName: appName });
  } catch {
    return false;
  }
}

export function listChromeLaunchArgumentList(
  defaultUrl: string,
  profileRoot: string = readBridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): string[] {
  return [
    `--remote-debugging-port=${port}`,
    // Chrome 136+ rejects CDP clients without an explicit allowlist.
    "--remote-allow-origins=*",
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Extension workers crash Playwright's connectOverCDP, and sign-in lives in cookies, so extensions are disabled.
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    // Claude Design runs its agent loop inside the tab, so a throttled background tab stalls the turn.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    defaultUrl,
  ];
}

export function spawnChrome(
  defaultUrl: string,
  profileRoot: string = readBridgeChromeProfileRoot(),
  port: number = BRIDGE_DEBUG_PORT,
): void {
  mkdirSync(profileRoot, { recursive: true });

  launchChrome({ args: listChromeLaunchArgumentList(defaultUrl, profileRoot, port) });
}
