import { type ChildProcess, spawn } from "node:child_process";

/** Spawn cloudflared for a local HTTP port. */
function spawnCloudflared(localPort: number): ChildProcess {
  return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Attach stdout/stderr listeners that extract the tunnel URL from cloudflared output. */
function attachTunnelOutput(input: {
  proc: ChildProcess;
  state: { publicUrl: string; settled: boolean };
  settle: (result: { url?: string; error?: Error }) => void;
  clear: () => void;
}): void {
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
}

/** Attach process error/exit handlers for tunnel startup failures. */
function attachTunnelLifecycle(input: {
  proc: ChildProcess;
  state: { publicUrl: string; settled: boolean };
  settle: (result: { url?: string; error?: Error }) => void;
  clear: () => void;
}): void {
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
}

/** Wait until cloudflared prints a public trycloudflare.com URL. */
function waitForTunnelUrl(proc: ChildProcess): Promise<string> {
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
}

/**
 * Backward-compatible class wrapper that manages a Cloudflare Tunnel subprocess.
 *
 * Callers that need a simple `new CloudflareTunnelClass()` with `start`/`stop`/`getUrl`
 * use this directly. For Effect-based consumers, prefer the `CloudflareTunnel` Tag and
 * `CloudflareTunnelLive` Layer.
 */
export class CloudflareTunnelClass {
  private proc: ChildProcess | null = null;
  private publicUrl = "";

  /**
   * Start the tunnel, returning the public HTTPS URL.
   *
   * @param localPort - The local port to expose.
   * @returns The public tunnel URL.
   */
  async start(localPort: number): Promise<string> {
    this.proc = spawnCloudflared(localPort);
    this.publicUrl = await waitForTunnelUrl(this.proc);
    return this.publicUrl;
  }

  /**
   * Get the current public URL (empty string if not started).
   *
   * @returns The current public URL.
   */
  getUrl(): string {
    return this.publicUrl;
  }

  /**
   * Stop the tunnel.
   */
  stop(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }
}
