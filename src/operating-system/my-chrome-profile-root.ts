import { posix, win32 } from "node:path";
import type { OperatingSystem } from "@/operating-system/read-operating-system.ts";

export function readMyChromeProfileRootOnSystem(details: {
  readonly operatingSystem: OperatingSystem;
  readonly home: string;
  readonly environment?: NodeJS.ProcessEnv;
}): string {
  const { operatingSystem, home } = details;
  const environment = details.environment ?? process.env;

  if (operatingSystem === "windows") {
    const localAppData = environment.LOCALAPPDATA;

    const isLocalAppDataMissing = localAppData == null || localAppData.length === 0;
    if (isLocalAppDataMissing) {
      throw new Error("LOCALAPPDATA is not set, so your Chrome profile folder cannot be found.");
    }

    return win32.join(localAppData, "Google", "Chrome", "User Data");
  }

  if (operatingSystem === "linux") return posix.join(home, ".config", "google-chrome");

  return posix.join(home, "Library", "Application Support", "Google", "Chrome");
}
