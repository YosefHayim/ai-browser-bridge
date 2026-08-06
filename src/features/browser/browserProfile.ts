import { homedir } from "node:os";
import { join } from "node:path";

export const CHROME_APP_NAME_ENV = "AI_BROWSER_BRIDGE_CHROME_APP";
export const DEFAULT_CHROME_APP_NAME = "Google Chrome";
/** First debug port used by isolated profiles; the shared bridge profile owns 9222. */
export const BRIDGE_ISOLATED_PORT_BASE = 9223;
/** Debug-port span isolated profiles hash into, keeping them off the shared 9222. */
const BRIDGE_ISOLATED_PORT_SPAN = 100;
// Profile-name char class: lowercase alphanumerics plus dot/underscore/hyphen survive; any
// other run collapses to a single hyphen so the name is a safe single path segment.
const UNSAFE_PROFILE_CHARS = /[^a-z0-9._-]+/g;
const PROFILE_EDGE_HYPHENS = /^-+|-+$/g;

/** Shared Chrome profile used by bridge-launched debug sessions. */
export const bridgeChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profile");
};

/** Chrome app name for macOS `open -na`, overridable via `AI_BROWSER_BRIDGE_CHROME_APP`. */
export const chromeAppName = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredName = env[CHROME_APP_NAME_ENV]?.trim();
  if (configuredName === undefined || configuredName.length === 0) {
    return DEFAULT_CHROME_APP_NAME;
  }
  return configuredName;
};

/** Parent directory for isolated Chrome profiles (one signed-in second account each). */
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

/** FNV-1a hash, kept stable so a profile name always maps to the same debug port. */
const stableHash = (value: string): number => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

/** Resolved isolated profile: sanitized name, on-disk root, and dedicated debug port. */
export type IsolatedProfile = {
  readonly name: string;
  readonly profileRoot: string;
  readonly debugPort: number;
};

/**
 * Resolve an isolate name to its on-disk profile root and a stable debug port.
 * Pure path/port math — nothing is created on disk.
 */
export const isolatedProfile = (name: string, home: string = homedir()): IsolatedProfile => {
  const sanitizedName = sanitizeProfileName(name);
  return {
    name: sanitizedName,
    profileRoot: join(isolatedProfilesRoot(home), sanitizedName),
    debugPort: BRIDGE_ISOLATED_PORT_BASE + (stableHash(sanitizedName) % BRIDGE_ISOLATED_PORT_SPAN),
  };
};
