import { execFile } from "node:child_process";

/** Whether a Google Chrome process is running on macOS. */
export function isChromeProcessRunning(_input: { unused?: true } = {}): Promise<boolean> {
  return new Promise((done) => {
    execFile("pgrep", ["-x", "Google Chrome"], (...execArgs) => {
      const err = execArgs[0] as NodeJS.ErrnoException | null;
      const stdout = execArgs[1] as string;
      done(!err && stdout.trim().length > 0);
    });
  });
}
