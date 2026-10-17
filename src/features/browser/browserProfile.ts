import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { type BrowserChoice, BrowserChoiceSchema } from "./browserSchemas.ts";

export const BROWSER_CHOICE_ENV = "AI_BROWSER_BRIDGE_BROWSER";
export const CHROME_APP_NAME_ENV = "AI_BROWSER_BRIDGE_CHROME_APP";
export const DEFAULT_CHROME_APP_NAME = "Google Chrome";
// First debug port used by isolated profiles; the shared bridge profile owns 9222.
export const BRIDGE_ISOLATED_PORT_BASE = 9223;
// Debug-port span isolated profiles hash into, keeping them off the shared 9222.
const BRIDGE_ISOLATED_PORT_SPAN = 100;
// Profile-name char class: lowercase alphanumerics plus dot/underscore/hyphen survive; any
// other run collapses to a single hyphen so the name is a safe single path segment.
const UNSAFE_PROFILE_CHARS = /[^a-z0-9._-]+/g;
const PROFILE_EDGE_HYPHENS = /^-+|-+$/g;
// DevToolsActivePort holds the port on line 1 and the browser websocket path on line 2.
const DEVTOOLS_ACTIVE_PORT = /^(?<port>\d+)\s+(?<browserPath>\/devtools\/browser\/\S+)/;

export const bridgeChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profile");
};

export const myChromeDataRoot = (home: string = homedir()): string => {
  return join(home, "Library", "Application Support", "Google", "Chrome");
};

export type MyChromeDebugTarget = {
  readonly port: number;
  readonly endpoint: string;
};

export const debugTargetFromActivePort = (activePort: string): MyChromeDebugTarget | undefined => {
  const activePortParts = DEVTOOLS_ACTIVE_PORT.exec(activePort)?.groups;
  if (activePortParts === undefined) return undefined;
  const port = Number(activePortParts.port);
  return { port, endpoint: `ws://127.0.0.1:${port}${activePortParts.browserPath}` };
};

const readActivePortFile = (dataRoot: string): string | undefined => {
  try {
    return readFileSync(join(dataRoot, "DevToolsActivePort"), "utf8");
  } catch {
    return undefined;
  }
};

// Chrome writes DevToolsActivePort only while chrome://inspect remote debugging is on.
export const myChromeDebugTarget = (
  dataRoot: string = myChromeDataRoot(),
): MyChromeDebugTarget | undefined => {
  const activePort = readActivePortFile(dataRoot);
  if (activePort === undefined) return undefined;
  return debugTargetFromActivePort(activePort);
};

const isBrowserChoice = Schema.is(BrowserChoiceSchema);

export const configuredBrowserChoice = (env: NodeJS.ProcessEnv = process.env): BrowserChoice => {
  const configuredChoice = env[BROWSER_CHOICE_ENV]?.trim();
  if (configuredChoice === undefined || configuredChoice.length === 0) return "bridge-profile";
  if (isBrowserChoice(configuredChoice)) return configuredChoice;
  throw new Error(
    `${BROWSER_CHOICE_ENV} must be "bridge-profile" or "my-chrome", not "${configuredChoice}".`,
  );
};

export const chromeAppName = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredName = env[CHROME_APP_NAME_ENV]?.trim();
  if (configuredName === undefined || configuredName.length === 0) {
    return DEFAULT_CHROME_APP_NAME;
  }
  return configuredName;
};

export const isolatedProfilesRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profiles");
};

const sanitizeProfileName = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(UNSAFE_PROFILE_CHARS, "-")
    .replace(PROFILE_EDGE_HYPHENS, "");
  if (cleaned.length === 0) {
    return "profile";
  }
  return cleaned;
};

// FNV-1a hash, kept stable so a profile name always maps to the same debug port.
const stableHash = (value: string): number => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export type IsolatedProfile = {
  readonly name: string;
  readonly profileRoot: string;
  readonly debugPort: number;
};

// Pure path/port math for an isolate name — nothing is created on disk.
export const isolatedProfile = (name: string, home: string = homedir()): IsolatedProfile => {
  const sanitizedName = sanitizeProfileName(name);
  return {
    name: sanitizedName,
    profileRoot: join(isolatedProfilesRoot(home), sanitizedName),
    debugPort: BRIDGE_ISOLATED_PORT_BASE + (stableHash(sanitizedName) % BRIDGE_ISOLATED_PORT_SPAN),
  };
};
