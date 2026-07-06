import { type ChildProcess, spawn } from "node:child_process";
import { Context, Effect, Layer } from "effect";
import { CloudflareTunnelError } from "./tunnelSchemas.ts";

/**
 * Service interface for the Cloudflare Tunnel subprocess manager.
 */
export interface CloudflareTunnelService {
  /**
   * Start the tunnel, returning the public HTTPS URL.
   *
   * @param localPort - The local port to expose.
   * @returns The public tunnel URL.
   */
  readonly start: (localPort: number) => Effect.Effect<string, CloudflareTunnelError>;

  /**
   * Get the current public URL (empty string if not started).
   *
   * @returns The current public URL.
   */
  readonly getUrl: () => Effect.Effect<string>;

  /**
   * Stop the tunnel subprocess.
   *
   * @returns void
   */
  readonly stop: () => Effect.Effect<void>;
}

/** Context Tag for the Cloudflare Tunnel service. */
export class CloudflareTunnel extends Context.Tag("CloudflareTunnel")<
  CloudflareTunnel,
  CloudflareTunnelService
>() {}

/** Spawn cloudflared for a local HTTP port. */
const spawnCloudflared = (localPort: number): ChildProcess => {
  return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
};

/** Attach stdout/stderr listeners that extract the tunnel URL from cloudflared output. */
const attachTunnelOutput = (input: {
  proc: ChildProcess;
  state: { publicUrl: string; settled: boolean };
  settle: (result: { url?: string; error?: Error }) => void;
  clear: () => void;
}): void => {
  const onLine = (line: string) => {
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!match) return;
    input.state.publicUrl = match[0];
    input.clear();
    input.settle({ url: match[0] });
  };
  input.proc.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) onLine(line);
  });
  input.proc.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) onLine(line);
  });
};

/** Attach process error/exit handlers for tunnel startup failures. */
const attachTunnelLifecycle = (input: {
  proc: ChildProcess;
  state: { publicUrl: string; settled: boolean };
  settle: (result: { url?: string; error?: Error }) => void;
  clear: () => void;
}): void => {
  input.proc.on("error", (err) => {
    input.clear();
    input.settle({ error: err });
  });
  input.proc.on("exit", (code) => {
    input.clear();
    if (code !== 0 && !input.state.publicUrl) {
      input.settle({ error: new Error(`cloudflared exited with code ${code}`) });
    }
  });
};

/** Wait until cloudflared prints a public trycloudflare.com URL. */
const waitForTunnelUrl = (proc: ChildProcess): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const state = { publicUrl: "", settled: false };
    const settle = (result: { url?: string; error?: Error }) => {
      if (state.settled) return;
      state.settled = true;
      if (result.error) reject(result.error);
      else resolve(result.url ?? "");
    };
    const timeout = setTimeout(() => {
      settle({ error: new Error("Timed out waiting for tunnel URL") });
    }, 30_000);
    const clear = () => clearTimeout(timeout);
    attachTunnelOutput({ proc, state, settle, clear });
    attachTunnelLifecycle({ proc, state, settle, clear });
  });
};

/** Live implementation of the CloudflareTunnel service. */
export const CloudflareTunnelLive: Layer.Layer<CloudflareTunnel> = Layer.sync(
  CloudflareTunnel,
  () => {
    let proc: ChildProcess | null = null;
    let publicUrl = "";

    return {
      start: (localPort: number) =>
        Effect.tryPromise({
          try: async () => {
            proc = spawnCloudflared(localPort);
            publicUrl = await waitForTunnelUrl(proc);
            return publicUrl;
          },
          catch: (error) =>
            new CloudflareTunnelError({
              message: error instanceof Error ? error.message : String(error),
            }),
        }),

      getUrl: () => Effect.sync(() => publicUrl),

      stop: () =>
        Effect.sync(() => {
          if (proc) {
            proc.kill("SIGTERM");
            proc = null;
          }
        }),
    };
  },
);
