import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listChromeProcesses } from "@/operating-system/chrome-processes.ts";
import { findChromeExecutable } from "@/operating-system/find-chrome-executable.ts";
import { readOperatingSystem } from "@/operating-system/read-operating-system.ts";

const operatingSystem = readOperatingSystem();
const profileDirectory = mkdtempSync(join(tmpdir(), "bridge-chrome-launch-"));
const activePortFile = join(profileDirectory, "DevToolsActivePort");
const startupTimeoutMilliseconds = 20_000;

const findChromePath = (): string | null => {
  try {
    return findChromeExecutable({ operatingSystem });
  } catch {
    return null;
  }
};

const chromePath = findChromePath();
const isChromeMissing = chromePath == null || !existsSync(chromePath);

let chromeProcess: ChildProcess | null = null;

const stopChromeTree = async (child: ChildProcess): Promise<void> => {
  const { pid } = child;

  const isPidMissing = pid == null;
  if (isPidMissing) return;

  if (operatingSystem === "windows") {
    await new Promise<void>((fulfillKill) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => fulfillKill());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
};

const waitForActivePort = async (): Promise<number> => {
  const deadline = Date.now() + startupTimeoutMilliseconds;
  while (Date.now() < deadline) {
    const isFileThere = existsSync(activePortFile);
    if (isFileThere) {
      const [portLine = ""] = readFileSync(activePortFile, "utf8").split("\n");
      const port = Number(portLine);

      const isPortValid = Number.isInteger(port) && port > 0;
      if (isPortValid) return port;
    }

    await new Promise((fulfillWait) => setTimeout(fulfillWait, 200));
  }
  throw new Error(`Chrome did not write ${activePortFile} within 20s`);
};

afterAll(async () => {
  if (chromeProcess != null) await stopChromeTree(chromeProcess);

  // Chrome may still hold files for a moment after it is killed.
  rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

describe("real Chrome launch", () => {
  it.skipIf(isChromeMissing)(
    "starts Chrome, lists its process and answers on the debug port",
    async () => {
      const chromeArguments = [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDirectory}`,
        "--no-first-run",
        "--no-default-browser-check",
        // Linux CI runners cannot use Chrome's sandbox.
        ...(operatingSystem === "linux" ? ["--no-sandbox"] : []),
        "about:blank",
      ];
      chromeProcess = spawn(chromePath ?? "", chromeArguments, {
        detached: operatingSystem !== "windows",
        stdio: "ignore",
      });

      const port = await waitForActivePort();
      const chromeProcesses = await listChromeProcesses(operatingSystem);
      const versionReply = await fetch(`http://127.0.0.1:${port}/json/version`);

      const profileProcess = chromeProcesses.find((listedProcess) =>
        listedProcess.commandLine.includes(profileDirectory),
      );
      expect(profileProcess).toBeDefined();
      expect(versionReply.ok).toBe(true);
    },
    40_000,
  );
});
