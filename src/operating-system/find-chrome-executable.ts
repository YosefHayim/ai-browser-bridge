import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";
import { readChromeAppName } from "@/browser/browser-profile.ts";
import {
  type OperatingSystem,
  readOperatingSystem,
} from "@/operating-system/read-operating-system.ts";

const CHROME_PATH_ENVIRONMENT = "AI_BROWSER_BRIDGE_CHROME_PATH";

const LINUX_CHROME_NAMES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
];

const WINDOWS_INSTALL_FOLDER_VARIABLES = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];

export interface FindChromeExecutableDetails {
  readonly operatingSystem?: OperatingSystem;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fileExists?: (path: string) => boolean;
}

const listWindowsCandidatePaths = (environment: NodeJS.ProcessEnv): string[] => {
  const candidatePaths: string[] = [];

  for (const variableName of WINDOWS_INSTALL_FOLDER_VARIABLES) {
    const installFolder = environment[variableName];

    const isInstallFolderMissing = installFolder == null || installFolder.length === 0;
    if (isInstallFolderMissing) continue;

    candidatePaths.push(win32.join(installFolder, "Google", "Chrome", "Application", "chrome.exe"));
  }

  return candidatePaths;
};

const listLinuxCandidatePaths = (environment: NodeJS.ProcessEnv): string[] => {
  const searchFolders = (environment.PATH ?? "").split(":").filter((folder) => folder.length > 0);

  return searchFolders.flatMap((searchFolder) =>
    LINUX_CHROME_NAMES.map((chromeName) => posix.join(searchFolder, chromeName)),
  );
};

const listCandidatePaths = (
  operatingSystem: OperatingSystem,
  environment: NodeJS.ProcessEnv,
): string[] => {
  if (operatingSystem === "windows") return listWindowsCandidatePaths(environment);
  if (operatingSystem === "linux") return listLinuxCandidatePaths(environment);

  const appName = readChromeAppName(environment);
  return [`/Applications/${appName}.app/Contents/MacOS/${appName}`];
};

export const findChromeExecutable = (details: FindChromeExecutableDetails = {}): string => {
  const operatingSystem = details.operatingSystem ?? readOperatingSystem();
  const environment = details.environment ?? process.env;
  const fileExists = details.fileExists ?? existsSync;

  const configuredPath = environment[CHROME_PATH_ENVIRONMENT]?.trim();

  const isConfiguredPathFound = configuredPath != null && configuredPath.length > 0;
  if (isConfiguredPathFound) return configuredPath;

  const candidatePaths = listCandidatePaths(operatingSystem, environment);
  const foundPath = candidatePaths.find((candidatePath) => fileExists(candidatePath));

  const isChromeFound = foundPath != null;
  if (isChromeFound) return foundPath;

  const checkedPaths = candidatePaths.join(", ") || "(no folders to search)";
  throw new Error(
    `Could not find Chrome. Checked: ${checkedPaths}. Set ${CHROME_PATH_ENVIRONMENT} to the Chrome executable.`,
  );
};
