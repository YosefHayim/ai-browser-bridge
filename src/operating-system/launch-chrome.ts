import { spawn } from "node:child_process";
import { readChromeAppName } from "@/browser/browser-profile.ts";
import { findChromeExecutable } from "@/operating-system/find-chrome-executable.ts";
import {
  type OperatingSystem,
  readOperatingSystem,
} from "@/operating-system/read-operating-system.ts";

type SpawnProcess = (
  command: string,
  argumentList: string[],
  settings: { readonly detached: true; readonly stdio: "ignore" },
) => { unref: () => void };

interface LaunchChromeDetails {
  readonly args: string[];
  readonly operatingSystem?: OperatingSystem;
  readonly spawnProcess?: SpawnProcess;
  readonly findChromePath?: () => string;
}

export function launchChrome(details: LaunchChromeDetails): void {
  const operatingSystem = details.operatingSystem ?? readOperatingSystem();
  const spawnProcess = details.spawnProcess ?? spawn;
  const findChromePath =
    details.findChromePath ?? (() => findChromeExecutable({ operatingSystem }));
  const spawnSettings = { detached: true, stdio: "ignore" } as const;

  if (operatingSystem === "macos") {
    const openArguments = ["-na", readChromeAppName(), "--args", ...details.args];
    spawnProcess("open", openArguments, spawnSettings).unref();
    return;
  }

  const chromePath = findChromePath();
  spawnProcess(chromePath, details.args, spawnSettings).unref();
}
