import type { Page } from "playwright";
import { chromeProfileDir } from "../../store/paths.ts";
import { prepareProfileDirectories } from "./browser-launch.helpers.ts";
import { attachOnlyError, chromeAlreadyRunningError, spawnChrome, spawnReadyError } from "./browser-launch.errors.ts";
import { BrowserAttachError } from "./browser-attach.error.ts";
import { BRIDGE_DEBUG_PORT } from "./browser-manager.constants.ts";
import { waitForDebugPort, isDebugPortListening } from "./chrome-debug.ts";
import { isChromeProcessRunning } from "./chrome-process.ts";
import type { BrowserProvider } from "../browser-provider.types.ts";
import type { BridgeProviderId } from "../create-provider.factory.ts";

/** Mutable browser launch state shared with BrowserManager. */
export interface BrowserLaunchContext {
  repoPath: string;
  providerId: BridgeProviderId;
  provider: BrowserProvider;
  attachedViaCdp: { value: boolean };
  spawnedNew: { value: boolean };
  hasActiveSession: () => boolean;
  close: () => Promise<void>;
  connectExisting: (opts?: { attempts?: number; intervalMs?: number }) => Promise<boolean>;
  getPage: () => Page;
  hasPage: () => boolean;
}

/** Launch Chrome or attach to an existing debug session. */
export async function runBrowserLaunch(context: BrowserLaunchContext, attachOnly?: boolean): Promise<Page> {
  await resetBrowserSession(context);
  prepareProfileDirectories({ repoPath: context.repoPath, profileDir: chromeProfileDir(context.repoPath, context.providerId) });
  if (await context.connectExisting()) return markAttached(context);
  return await continueBrowserLaunch({ context, attachOnly });
}

async function resetBrowserSession(context: BrowserLaunchContext): Promise<void> {
  if (context.hasActiveSession()) await context.close();
}

function markAttached(context: BrowserLaunchContext): Page {
  context.attachedViaCdp.value = true;
  return context.getPage();
}

async function continueBrowserLaunch(input: { context: BrowserLaunchContext; attachOnly?: boolean }): Promise<Page> {
  if (input.attachOnly) throw attachOnlyError();
  if (await isDebugPortListening({ port: BRIDGE_DEBUG_PORT })) {
    return await attachViaOpenDebugPort(input.context);
  }
  if (await isChromeProcessRunning()) throw chromeAlreadyRunningError();
  return await runSpawnAndConnect(input.context);
}

/** Retry CDP attach when the debug port is already listening. */
async function attachViaOpenDebugPort(context: BrowserLaunchContext): Promise<Page> {
  const connected = await context.connectExisting({ attempts: 20, intervalMs: 500 });
  if (connected) return context.getPage();
  throw new BrowserAttachError(
    `Chrome debug port ${BRIDGE_DEBUG_PORT} is open but the bridge could not attach. Close other Chrome windows or run \`bridge login\`.`,
  );
}

/** Spawn Chrome and wait for CDP connection. */
export async function runSpawnAndConnect(context: BrowserLaunchContext): Promise<Page> {
  spawnChrome({ profileDir: chromeProfileDir(context.repoPath, context.providerId), defaultUrl: context.provider.defaultUrl });
  context.spawnedNew.value = true;
  console.error("  Waiting for Chrome debug port...");
  await waitForDebugPort({ port: BRIDGE_DEBUG_PORT });
  return await finishSpawnAndConnect(context);
}

async function finishSpawnAndConnect(context: BrowserLaunchContext): Promise<Page> {
  const connected = await context.connectExisting({ attempts: 20, intervalMs: 500 });
  if (!connected || !context.hasPage()) throw spawnReadyError();
  return context.getPage();
}
