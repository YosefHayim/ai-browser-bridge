import { type ChildProcess, spawn } from "node:child_process";

/** Manages a Cloudflare Tunnel (cloudflared) that exposes a local port over HTTPS. */
export class CloudflareTunnel {
  private proc: ChildProcess | null = null;
  private publicUrl = "";

  /** Start the tunnel, returning the public HTTPS URL. */
  async start(localPort: number): Promise<string> {
    this.proc = this.spawnCloudflared(localPort);
    this.publicUrl = await this.waitForTunnelUrl(this.proc);
    return this.publicUrl;
  }

  /** Get the current public URL (empty string if not started). */
  getUrl(): string {
    return this.publicUrl;
  }

  /** Stop the tunnel. */
  stop(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  /** Spawn cloudflared for a local HTTP port. */
  private spawnCloudflared(localPort: number): ChildProcess {
    return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /** Wait until cloudflared prints a public trycloudflare.com URL. */
  private async waitForTunnelUrl(proc: ChildProcess): Promise<string> {
    const result = await new Promise<{ url?: string; error?: Error }>((done) => {
      const state = { publicUrl: "", settled: false };
      this.wireTunnelProcess(proc, {
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

  /** Wire cloudflared stdout/stderr and lifecycle handlers for tunnel URL discovery. */
  private wireTunnelProcess(
    proc: ChildProcess,
    input: {
      state: { publicUrl: string; settled: boolean };
      settle: (result: { url?: string; error?: Error }) => void;
    },
  ): void {
    const timeout = setTimeout(() => {
      input.settle({ error: new Error("Timed out waiting for tunnel URL") });
    }, 30_000);
    const clear = () => clearTimeout(timeout);
    this.attachTunnelOutput({ proc, state: input.state, settle: input.settle, clear });
    this.attachTunnelLifecycle({ proc, state: input.state, settle: input.settle, clear });
  }

  /** Attach stdout/stderr listeners that extract the tunnel URL from cloudflared output. */
  private attachTunnelOutput(input: {
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
  private attachTunnelLifecycle(input: {
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
}
