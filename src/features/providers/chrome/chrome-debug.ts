import { BRIDGE_DEBUG_PORT } from "./browser-manager.constants.ts";

interface SleepInput {
  /** Delay duration in milliseconds. */
  ms: number;
}

/** Promise-based sleep helper. */
export function sleep(input: SleepInput | number): Promise<void> {
  const ms = typeof input === "number" ? input : input.ms;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DebugPortInput {
  /** Remote debugging port to probe. */
  port?: number;
}

/** Whether localhost responds on the Chrome remote debugging port. */
export async function isDebugPortListening(input: DebugPortInput | number = {}): Promise<boolean> {
  const port = typeof input === "number" ? input : input.port ?? BRIDGE_DEBUG_PORT;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
    return resp.ok;
  } catch {
    return false;
  }
}

interface WaitForPortInput {
  /** Remote debugging port to wait for. */
  port: number;
  /** Maximum wait time in milliseconds. */
  maxWaitMs?: number;
}

/** Poll until the Chrome debug port becomes available. */
export async function waitForDebugPort(input: WaitForPortInput): Promise<void> {
  const maxWaitMs = input.maxWaitMs ?? 30_000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isDebugPortListening({ port: input.port })) return;
    await sleep({ ms: 500 });
  }
  throw new Error(`Timed out waiting for Chrome debug port ${input.port}`);
}
