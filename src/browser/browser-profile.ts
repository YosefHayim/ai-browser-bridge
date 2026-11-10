import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type BrowserChoice, BrowserChoiceSchema } from "./browser-schemas.ts";

const AI_BROWSER_BRIDGE_FOLDER_NAME = ".ai-browser-bridge";

export const BROWSER_CHOICE_ENVIRONMENT = "AI_BROWSER_BRIDGE_BROWSER";
const CHROME_APP_NAME_ENVIRONMENT = "AI_BROWSER_BRIDGE_CHROME_APP";
const DEFAULT_CHROME_APP_NAME = "Google Chrome";
// First debug port used by isolated profiles; the shared bridge profile owns 9222.
const BRIDGE_ISOLATED_PORT_BASE = 9223;
// Debug-port span isolated profiles hash into, keeping them off the shared 9222.
const BRIDGE_ISOLATED_PORT_SPAN = 100;
// Keep lowercase letters, digits, dot, underscore and hyphen; collapse any other run to one hyphen.
const UNSAFE_PROFILE_CHARS = /[^a-z0-9._-]+/g;
const PROFILE_EDGE_HYPHENS = /^-+|-+$/g;
// DevToolsActivePort holds the port on line 1 and the browser websocket path on line 2.
const DEVTOOLS_ACTIVE_PORT = /^(?<port>\d+)\s+(?<browserPath>\/devtools\/browser\/\S+)/;

export const readBridgeChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, AI_BROWSER_BRIDGE_FOLDER_NAME, "chrome-profile");
};

export const readMyChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, "Library", "Application Support", "Google", "Chrome");
};

export type MyChromeDebugTarget = {
  readonly port: number;
  readonly endpoint: string;
};

export const readDebugTargetFromActivePort = (activePort: string): MyChromeDebugTarget | null => {
  const activePortParts = DEVTOOLS_ACTIVE_PORT.exec(activePort)?.groups;

  const isActivePortPartsMissing = activePortParts == null;
  if (isActivePortPartsMissing) return null;

  const port = Number(activePortParts.port);
  return { port, endpoint: `ws://127.0.0.1:${port}${activePortParts.browserPath}` };
};

const readActivePortFile = (profileRoot: string): string | null => {
  try {
    const activePortPath = join(profileRoot, "DevToolsActivePort");
    return readFileSync(activePortPath, "utf8");
  } catch {
    return null;
  }
};

// Chrome writes DevToolsActivePort only while chrome://inspect remote debugging is on.
export const readMyChromeDebugTarget = (
  profileRoot: string = readMyChromeProfileRoot(),
): MyChromeDebugTarget | null => {
  const activePort = readActivePortFile(profileRoot);

  const isActivePortMissing = activePort == null;
  if (isActivePortMissing) return null;

  return readDebugTargetFromActivePort(activePort);
};

const isBrowserChoice = (choiceName: string): choiceName is BrowserChoice =>
  BrowserChoiceSchema.safeParse(choiceName).success;

export const readConfiguredBrowserChoice = (
  environment: NodeJS.ProcessEnv = process.env,
): BrowserChoice => {
  const configuredChoice = environment[BROWSER_CHOICE_ENVIRONMENT]?.trim();

  const isConfiguredChoiceBlank = configuredChoice == null || configuredChoice.length === 0;
  if (isConfiguredChoiceBlank) return "bridge-profile";

  if (isBrowserChoice(configuredChoice)) return configuredChoice;

  throw new Error(
    `${BROWSER_CHOICE_ENVIRONMENT} must be "bridge-profile" or "my-chrome", not "${configuredChoice}".`,
  );
};

export const readChromeAppName = (environment: NodeJS.ProcessEnv = process.env): string => {
  const configuredName = environment[CHROME_APP_NAME_ENVIRONMENT]?.trim();

  const isConfiguredNameBlank = configuredName == null || configuredName.length === 0;
  if (isConfiguredNameBlank) {
    return DEFAULT_CHROME_APP_NAME;
  }

  return configuredName;
};

const readIsolatedProfilesRoot = (home: string = homedir()): string => {
  return join(home, AI_BROWSER_BRIDGE_FOLDER_NAME, "chrome-profiles");
};

const sanitizeProfileName = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(UNSAFE_PROFILE_CHARS, "-")
    .replace(PROFILE_EDGE_HYPHENS, "");

  const isCleanedEmpty = cleaned.length === 0;
  if (isCleanedEmpty) {
    return "profile";
  }

  return cleaned;
};

// FNV-1a hash, kept stable so a profile name always maps to the same debug port.
const createStableHash = (field: string): number => {
  let hash = 2_166_136_261;

  for (let i = 0; i < field.length; i++) {
    hash ^= field.charCodeAt(i);
    const fnvPrime = 16_777_619;

    hash = Math.imul(hash, fnvPrime);
  }

  return hash >>> 0;
};

type IsolatedProfile = {
  readonly name: string;
  readonly profileRoot: string;
  readonly debugPort: number;
};

export const readIsolatedProfile = (name: string, home: string = homedir()): IsolatedProfile => {
  const sanitizedName = sanitizeProfileName(name);
  const isolatedProfilesRoot = readIsolatedProfilesRoot(home);

  return {
    name: sanitizedName,
    profileRoot: join(isolatedProfilesRoot, sanitizedName),
    debugPort:
      BRIDGE_ISOLATED_PORT_BASE + (createStableHash(sanitizedName) % BRIDGE_ISOLATED_PORT_SPAN),
  };
};
