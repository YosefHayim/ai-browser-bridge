import { execFile } from "node:child_process";
import {
  type OperatingSystem,
  readOperatingSystem,
} from "@/operating-system/read-operating-system.ts";

type RunCommandWithInput = (
  command: string,
  argumentList: string[],
  inputText: string,
) => Promise<void>;

interface ClipboardCommand {
  readonly command: string;
  readonly argumentList: string[];
}

interface CopyTextToClipboardDetails {
  readonly clipboardText: string;
  readonly operatingSystem?: OperatingSystem;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runCommand?: RunCommandWithInput;
}

const runCommandWithExecFile: RunCommandWithInput = (command, argumentList, inputText) => {
  return new Promise<void>((fulfillRun, rejectRun) => {
    const child = execFile(command, argumentList, (error) => {
      const isErrorFound = error != null;
      if (isErrorFound) rejectRun(error);
      else fulfillRun();
    });
    // A missing command also breaks the stdin pipe; the execFile callback already reports that error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(inputText);
  });
};

const listLinuxClipboardCommands = (environment: NodeJS.ProcessEnv): ClipboardCommand[] => {
  const clipboardCommands: ClipboardCommand[] = [];

  const isWaylandSession = (environment.WAYLAND_DISPLAY ?? "").length > 0;
  if (isWaylandSession) clipboardCommands.push({ command: "wl-copy", argumentList: [] });

  clipboardCommands.push({ command: "xclip", argumentList: ["-selection", "clipboard"] });
  clipboardCommands.push({ command: "xsel", argumentList: ["--clipboard", "--input"] });

  return clipboardCommands;
};

const isCommandNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export const copyTextToClipboard = async (details: CopyTextToClipboardDetails): Promise<void> => {
  const operatingSystem = details.operatingSystem ?? readOperatingSystem();
  const environment = details.environment ?? process.env;
  const runCommand = details.runCommand ?? runCommandWithExecFile;
  const { clipboardText } = details;

  if (operatingSystem === "macos") {
    await runCommand("pbcopy", [], clipboardText);
    return;
  }

  if (operatingSystem === "windows") {
    const windowsArguments = [
      "-NoProfile",
      "-Command",
      "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
    ];
    await runCommand("powershell", windowsArguments, clipboardText);
    return;
  }

  for (const clipboardCommand of listLinuxClipboardCommands(environment)) {
    try {
      await runCommand(clipboardCommand.command, clipboardCommand.argumentList, clipboardText);
      return;
    } catch (error) {
      const isErrorOtherThanMissingCommand = !isCommandNotFound(error);
      if (isErrorOtherThanMissingCommand) throw error;
    }
  }

  throw new Error("No clipboard tool found. Install wl-clipboard or xclip.");
};
