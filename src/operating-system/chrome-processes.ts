import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type OperatingSystem,
  readOperatingSystem,
} from "@/operating-system/read-operating-system.ts";

export interface ChromeProcess {
  readonly pid: number;
  readonly commandLine: string;
}

export type RunCommand = (command: string, argumentList: string[]) => Promise<string>;

const PS_LINE = /^\s*(?<pid>\d+)\s+(?<commandLine>.*)$/;

const WINDOWS_PROCESS_COMMAND = [
  "-NoProfile",
  "-Command",
  "Get-CimInstance -ClassName Win32_Process -Filter \"Name='chrome.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json",
];

const LINUX_CHROME_NAMES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
];

const execFileAsync = promisify(execFile);

const runCommandWithExecFile: RunCommand = async (command, argumentList) => {
  const maxOutputBytes = 64 * 1024 * 1024;
  const { stdout } = await execFileAsync(command, argumentList, { maxBuffer: maxOutputBytes });
  return stdout;
};

export function parsePsOutput(psOutput: string): ChromeProcess[] {
  const chromeProcesses: ChromeProcess[] = [];

  for (const line of psOutput.split("\n")) {
    const lineGroups = PS_LINE.exec(line)?.groups;

    const isLineIgnored = lineGroups == null;
    if (isLineIgnored) continue;

    chromeProcesses.push({
      pid: Number(lineGroups.pid),
      commandLine: lineGroups.commandLine ?? "",
    });
  }

  return chromeProcesses;
}

interface WindowsProcessRow {
  readonly ProcessId?: number | null;
  readonly CommandLine?: string | null;
}

export function parseWindowsProcessOutput(powershellOutput: string): ChromeProcess[] {
  const isOutputEmpty = powershellOutput.trim().length === 0;
  if (isOutputEmpty) return [];

  // ConvertTo-Json prints one object, not an array, when there is a single process.
  const processDocument = JSON.parse(powershellOutput) as WindowsProcessRow | WindowsProcessRow[];
  const processRows = Array.isArray(processDocument) ? processDocument : [processDocument];

  const chromeProcesses: ChromeProcess[] = [];
  for (const processRow of processRows) {
    const processId = processRow.ProcessId;

    const isProcessIdMissing = processId == null;
    if (isProcessIdMissing) continue;

    chromeProcesses.push({ pid: processId, commandLine: processRow.CommandLine ?? "" });
  }

  return chromeProcesses;
}

export async function listChromeProcesses(
  operatingSystem: OperatingSystem = readOperatingSystem(),
  runCommand: RunCommand = runCommandWithExecFile,
): Promise<ChromeProcess[]> {
  if (operatingSystem === "windows") {
    const powershellOutput = await runCommand("powershell", WINDOWS_PROCESS_COMMAND);
    return parseWindowsProcessOutput(powershellOutput);
  }

  const psOutput = await runCommand("ps", ["ax", "-o", "pid=,command="]);
  return parsePsOutput(psOutput);
}

function readExecutableBaseName(commandLine: string): string {
  const [executablePath = ""] = commandLine.split(" ");
  return executablePath.split("/").pop() ?? "";
}

export function isChromeInProcessList(details: {
  readonly chromeProcesses: readonly ChromeProcess[];
  readonly operatingSystem: OperatingSystem;
  readonly macosAppName: string;
}): boolean {
  const { chromeProcesses, operatingSystem, macosAppName } = details;

  if (operatingSystem === "windows") return chromeProcesses.length > 0;

  if (operatingSystem === "macos") {
    const appFolder = `${macosAppName}.app/Contents/MacOS`;
    return chromeProcesses.some((chromeProcess) => chromeProcess.commandLine.includes(appFolder));
  }

  return chromeProcesses.some((chromeProcess) =>
    LINUX_CHROME_NAMES.includes(readExecutableBaseName(chromeProcess.commandLine)),
  );
}
