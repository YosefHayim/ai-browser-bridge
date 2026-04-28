import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A Chrome user profile discovered from Local State. */
interface ChromeProfile {
  /** Directory name like "Default", "Profile 3". */
  dirName: string;
  /** Full path to the profile directory. */
  fullPath: string;
  /** Chrome root directory (parent of all profiles). */
  chromeRoot: string;
  /** Display name from Preferences (e.g. "zaatar.tech"). */
  name: string;
  /** Signed-in Google account email, if any. */
  email: string;
}

export const CHROME_ROOT = join(
  homedir(),
  "Library/Application Support/Google/Chrome",
);

/** Internal Chrome profiles that should never appear in the picker. */
const HIDDEN_PROFILES = new Set(["System Profile", "Guest Profile"]);

/** Detect Chrome profiles using Local State's profiles_order as the source of truth. */
export function detectChromeProfiles(): ChromeProfile[] {
  if (!existsSync(CHROME_ROOT)) return [];

  const orderedDirs = readProfilesOrder();
  if (orderedDirs.length === 0) return detectFromDirectories();

  const profiles: ChromeProfile[] = [];
  for (const dirName of orderedDirs) {
    if (HIDDEN_PROFILES.has(dirName)) continue;
    const prefPath = join(CHROME_ROOT, dirName, "Preferences");
    if (!existsSync(prefPath)) continue;

    const { name, email } = readProfilePrefs(prefPath);
    profiles.push({ dirName, fullPath: join(CHROME_ROOT, dirName), chromeRoot: CHROME_ROOT, name, email });
  }

  return profiles;
}

/** Read the ordered profile list from Chrome's Local State file. */
function readProfilesOrder(): string[] {
  const statePath = join(CHROME_ROOT, "Local State");
  if (!existsSync(statePath)) return [];

  try {
    const raw = readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw);
    return state?.profile?.profiles_order ?? [];
  } catch {
    return [];
  }
}

/** Fallback: scan directories for Preferences files when Local State is unavailable. */
function detectFromDirectories(): ChromeProfile[] {
  const entries = readdirSync(CHROME_ROOT, { withFileTypes: true });
  const profiles: ChromeProfile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (HIDDEN_PROFILES.has(entry.name)) continue;
    const prefPath = join(CHROME_ROOT, entry.name, "Preferences");
    if (!existsSync(prefPath)) continue;

    const { name, email } = readProfilePrefs(prefPath);
    profiles.push({ dirName: entry.name, fullPath: join(CHROME_ROOT, entry.name), chromeRoot: CHROME_ROOT, name, email });
  }

  return profiles;
}

function readProfilePrefs(prefPath: string): { name: string; email: string } {
  try {
    const raw = readFileSync(prefPath, "utf-8");
    const prefs = JSON.parse(raw);
    const name = prefs?.profile?.name ?? "Unknown";
    const accounts = prefs?.account_info;
    const email = Array.isArray(accounts) && accounts.length > 0 ? (accounts[0].email ?? "") : "";
    return { name, email };
  } catch {
    return { name: "Unknown", email: "" };
  }
}

/** Format a profile for display in a picker. */
export function profileLabel(p: ChromeProfile): string {
  const emailPart = p.email ? ` (${p.email})` : "";
  return `${p.name}${emailPart}  —  ${p.dirName}`;
}
