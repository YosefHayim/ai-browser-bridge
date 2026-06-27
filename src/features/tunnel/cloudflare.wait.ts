import type { ChildProcess } from "node:child_process";
import { wireTunnelProcess } from "./cloudflare.wire.ts";

interface TunnelWaitResult {
  url?: string;
  error?: Error;
}

/** Wait until cloudflared prints a public trycloudflare.com URL. */
export async function waitForTunnelUrl(proc: ChildProcess): Promise<string> {
  const result = await new Promise<TunnelWaitResult>((done) => {
    const state = { publicUrl: "", settled: false };
    wireTunnelProcess(proc, {
      state,
      settle: (value) => {
        if (state.settled) return;
        state.settled = true;
        done(value);
      },
    });
  });
  if (result.error) throw result.error;
  return result.url ?? "";
}
