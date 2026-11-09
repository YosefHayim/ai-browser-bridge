import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { bridgeChromeProfileRoot } from "@/features/browser/browserProfile.ts";
import type {
  BrowserStatus,
  CacheInventory,
  PruneCacheResult,
} from "@/features/browser/browserSchemas.ts";
import { BRIDGE_DEBUG_PORT, BrowserSession } from "@/features/browser/browserSession.ts";
import { readBrowserStatus } from "@/features/browser/browserState.ts";
import { inventoryChromeCache, pruneChromeCache } from "@/features/browser/chromeCache.ts";
import { providerIdFrom, webProviderFor } from "@/features/webProviders/providerRegistry.ts";
import type {
  BrowserStatusOptions,
  CacheCmdOptions,
  ChromeStartOptions,
} from "../presentation/cliTypes.ts";
import { exitWithCliError } from "../presentation/commandOutput.ts";
import { debugPortFromOption, profileRootFromOption } from "./browserConnection.ts";

const formatBrowserDebugStatus = (status: BrowserStatus): string => {
  return [
    `State: ${status.state}`,
    `Chrome running: ${status.chromeRunning ? "yes" : "no"}`,
    `Debug port: ${status.debugPortListening ? "ready" : "closed"} (${status.port})`,
    `Can attach: ${status.canAttach ? "yes" : "no"}`,
    `Profile root: ${browserProfileRootLabel(status)}`,
    `Message: ${status.message}`,
  ].join("\n");
};

const browserProfileRootLabel = (status: BrowserStatus): string => {
  if (status.userDataDir !== undefined && status.userDataDir !== null) return status.userDataDir;
  return status.bridgeProfileRoot;
};

const formatCacheInventory = (inventory: CacheInventory): string => {
  const lines = [
    `Chrome profile root: ${inventory.profileRoot}`,
    `Reclaimable generated cache: ${inventory.reclaimableBytes} bytes`,
    "",
    "Safe generated-cache targets:",
  ];
  for (const entry of inventory.entries) {
    const exists = entry.exists ? `${entry.bytes} bytes` : "missing";
    lines.push(`  ${entry.relativePath.padEnd(40)} ${exists}`);
  }
  return lines.join("\n");
};

const formatCachePruneResult = (cachePruneResult: PruneCacheResult): string => {
  return [
    `Chrome profile root: ${cachePruneResult.profileRoot}`,
    `Mode: ${cachePruneResult.dryRun ? "dry-run" : "confirmed prune"}`,
    `Deleted generated cache: ${cachePruneResult.deletedBytes} bytes`,
    "",
    "Safe generated-cache targets:",
    ...cachePruneResult.entries.map((entry) => {
      const status = entry.exists ? `${entry.bytes} bytes` : "missing";
      return `  ${entry.relativePath.padEnd(40)} ${status}`;
    }),
  ].join("\n");
};

export const runBrowserStatus = async (options: BrowserStatusOptions = {}): Promise<void> => {
  const status = await readBrowserStatus();
  if (options.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  else process.stdout.write(`${formatBrowserDebugStatus(status)}\n`);
  process.exit(0);
};

const cacheProfileRoot = (options: CacheCmdOptions): string => {
  return options.profile ? resolve(options.profile) : bridgeChromeProfileRoot();
};

export const runCacheList = async (options: CacheCmdOptions): Promise<void> => {
  const inventory = await inventoryChromeCache({
    profileRoot: cacheProfileRoot(options),
  });
  if (options.json) process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else process.stdout.write(`${formatCacheInventory(inventory)}\n`);
  process.exit(0);
};

export const runCachePrune = async (options: CacheCmdOptions): Promise<void> => {
  const dryRun = options.dryRun === undefined ? !options.yes : options.dryRun;
  if (!dryRun) await assertChromeClosedForCachePrune();
  const pruneResult = await pruneChromeCache({
    profileRoot: cacheProfileRoot(options),
    dryRun,
    confirm: options.yes,
  });
  if (options.json) process.stdout.write(`${JSON.stringify(pruneResult, null, 2)}\n`);
  else process.stdout.write(`${formatCachePruneResult(pruneResult)}\n`);
  process.exit(0);
};

const assertChromeClosedForCachePrune = async (): Promise<void> => {
  const status = await readBrowserStatus();
  if (!status.chromeRunning) return;
  exitWithCliError("Quit Chrome before pruning generated cache from the shared bridge profile.");
};

const killDebugPort = (port: number): Promise<boolean> => {
  return new Promise((resolveKill) => {
    execFile("lsof", ["-ti", `tcp:${port}`], (...commandCompletion: [Error | null, string]) => {
      resolveKill(killPidsFromStdout(commandCompletion[1]));
    });
  });
};

const killPidsFromStdout = (stdout: string): boolean => {
  const pids = stdout.trim().split(/\s+/).filter(Boolean);
  if (pids.length === 0) return false;
  for (const pid of pids) killPidBestEffort(pid);
  return true;
};

const killPidBestEffort = (pid: string): void => {
  try {
    process.kill(Number(pid));
  } catch {
    // process already gone
  }
};

export const runChromeStart = async (options: ChromeStartOptions = {}): Promise<void> => {
  await launchChromeBrowser(options);
  writeChromeStartInstructions(webProviderFor(providerIdFrom(options.provider)).displayName);
  process.exit(0);
};

const launchChromeBrowser = async (options: ChromeStartOptions): Promise<BrowserSession> => {
  const provider = providerIdFrom(options.provider);
  const browser = new BrowserSession(provider, {
    debugPort: debugPortFromOption(options.debugPort),
    profileRoot: profileRootFromOption(options.profile),
  });
  await browser.launch();
  return browser;
};

const writeChromeStartInstructions = (displayName: string): void => {
  process.stderr.write(
    `Chrome is open for ${displayName} with the bridge debug port.
This uses the shared bridge Chrome profile, so sign in once in this window and every repo can reuse it.
Leave this Chrome window open; \`bridge ask\` will reconnect to it.
`,
  );
};

export const runStop = async (): Promise<void> => {
  const killed = await killDebugPort(BRIDGE_DEBUG_PORT);
  process.stderr.write(
    killed ? "Closed the bridge browser.\n" : "No bridge browser was running.\n",
  );
  process.exit(0);
};
