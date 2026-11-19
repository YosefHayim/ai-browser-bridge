import type { MyChromeDebugTarget } from "@/browser/browser-profile.ts";
import { BROWSER_CHOICE_ENVIRONMENT } from "@/browser/browser-profile.ts";
import { sleep } from "@/browser/sleep.ts";

export const BRIDGE_DEBUG_PORT = 9222;

// localhost resolves to IPv4 or IPv6, since Chrome can listen only on [::1].
export function createDebugPortUrl(port: number): string {
  return `http://localhost:${port}`;
}

const debugPortCloseWaitMilliseconds = 10_000;

export async function waitForDebugPortClosed(
  port: number,
  maxWaitMilliseconds = debugPortCloseWaitMilliseconds,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMilliseconds) {
    const isPortListening = await isDebugPortListening({ port });

    const isDebugPortClosed = !isPortListening;
    if (isDebugPortClosed) return true;

    const debugPortClosePollMilliseconds = 250;

    await sleep(debugPortClosePollMilliseconds);
  }
  return false;
}

export async function isDebugPortListening(
  details: { readonly port?: number } = {},
): Promise<boolean> {
  let port = BRIDGE_DEBUG_PORT;

  const hasPort = details.port != null;
  if (hasPort) {
    port = details.port;
  }

  try {
    const debugPortUrl = createDebugPortUrl(port);
    const versionReply = await fetch(`${debugPortUrl}/json/version`);
    return versionReply.ok;
  } catch {
    return false;
  }
}

const debugPortPollMilliseconds = 500;

const debugPortWaitMilliseconds = 30_000;

export async function waitForDebugPort(
  port: number,
  maxWaitMilliseconds = debugPortWaitMilliseconds,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMilliseconds) {
    const isDebugPortOpen = await isDebugPortListening({ port });
    if (isDebugPortOpen) return;

    await sleep(debugPortPollMilliseconds);
  }
  throw new Error(`Timed out waiting for Chrome debug port ${port}`);
}

export async function readDebugPortVersionStatus(port: number): Promise<number | null> {
  try {
    const versionReply = await fetch(`http://127.0.0.1:${port}/json/version`);
    return versionReply.status;
  } catch {
    return null;
  }
}

// DevToolsActivePort outlives the toggle, so a port that answers without the bridge is not ours.
export function assertPortNotHeldByOwnChrome(
  port: number,
  ownChromeTarget: MyChromeDebugTarget | null,
  versionStatus: number | null,
): void {
  const isOwnChromeOnOtherPort = ownChromeTarget?.port !== port;
  if (isOwnChromeOnOtherPort) return;

  const httpStatusOk = 200;

  const isVersionCheckSettled = versionStatus == null || versionStatus === httpStatusOk;
  if (isVersionCheckSettled) return;

  throw new Error(
    `Your own Chrome is using port ${port} for remote debugging, so the bridge Chrome cannot use it. Set ${BROWSER_CHOICE_ENVIRONMENT}=my-chrome to use your own Chrome, or turn off remote debugging at chrome://inspect/#remote-debugging.`,
  );
}
