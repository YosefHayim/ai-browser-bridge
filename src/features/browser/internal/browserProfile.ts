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

/**
 * Shared Chrome profile used by bridge-launched debug sessions.
 *
 * @param home - Home directory used as the profile parent.
 * @returns The shared global bridge Chrome profile directory.
 * @example
 * ```ts
 * const profileRoot = bridgeChromeProfileRoot();
 * ```
 */
export const bridgeChromeProfileRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profile");
};

/**
 * Chrome app name used by macOS `open -na` when launching the bridge browser.
 *
 * @param env - Environment map that may contain `AI_BROWSER_BRIDGE_CHROME_APP`.
 * @returns The configured Chrome app name, or the regular Google Chrome app name.
 * @example
 * ```ts
 * const appName = chromeAppName({
 *   AI_BROWSER_BRIDGE_CHROME_APP: "Google Chrome for Testing",
 * });
 * ```
 */
export const chromeAppName = (env: NodeJS.ProcessEnv = process.env): string => {
  const configuredName = env[CHROME_APP_NAME_ENV]?.trim();
  return configuredName && configuredName.length > 0 ? configuredName : DEFAULT_CHROME_APP_NAME;
};

/**
 * Parent directory holding every isolated Chrome profile (one signed-in second account each).
 *
 * @param home - Home directory used as the profile parent.
 * @returns The `~/.ai-browser-bridge/chrome-profiles` directory.
 * @example
 * ```ts
 * const root = isolatedProfilesRoot();
 * ```
 */
export const isolatedProfilesRoot = (home: string = homedir()): string => {
  return join(home, ".ai-browser-bridge", "chrome-profiles");
};

const sanitizeProfileName = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(UNSAFE_PROFILE_CHARS, "-")
    .replace(PROFILE_EDGE_HYPHENS, "");
  return cleaned || "profile";
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

/** A resolved isolated profile: its sanitized name, on-disk root, and dedicated debug port. */
export interface IsolatedProfile {
  /** Sanitized profile name safe to use as a path segment. */
  name: string;
  /** Absolute profile directory under {@link isolatedProfilesRoot}. */
  profileRoot: string;
  /** Debug port dedicated to this profile (stable across runs so it can be reused). */
  debugPort: number;
}

/**
 * Resolve a caller-supplied isolate name to its on-disk profile root and a stable debug port.
 *
 * The port is derived from the name so the same profile lands on the same port across runs —
 * that is what lets an already-signed-in isolated Chrome be detected and reused instead of
 * re-launched. Nothing is created here; this is pure path/port math.
 *
 * @param name - Caller-facing isolate name (e.g. "work" or "second-account").
 * @param home - Home directory used as the profile parent.
 * @returns The sanitized name, absolute profile root, and dedicated debug port.
 * @example
 * ```ts
 * const profile = resolveIsolatedProfile("work");
 * // → { name: "work", profileRoot: "…/chrome-profiles/work", debugPort: 9223+ }
 * ```
 */
export const resolveIsolatedProfile = (name: string, home: string = homedir()): IsolatedProfile => {
  const safe = sanitizeProfileName(name);
  return {
    name: safe,
    profileRoot: join(isolatedProfilesRoot(home), safe),
    debugPort: BRIDGE_ISOLATED_PORT_BASE + (stableHash(safe) % BRIDGE_ISOLATED_PORT_SPAN),
  };
};
