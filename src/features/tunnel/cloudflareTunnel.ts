import { type ChildProcess, spawn } from "node:child_process";

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const TUNNEL_URL_TIMEOUT_MS = 30_000;

const spawnCloudflared = (localPort: number): ChildProcess => {
  return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
};

type TunnelSettle =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "error"; readonly error: Error };

type TunnelWaitState = {
  publicUrl: string;
  settled: boolean;
};

const attachTunnelOutput = (input: {
  proc: ChildProcess;
  state: TunnelWaitState;
  settle: (outcome: TunnelSettle) => void;
  clear: () => void;
}): void => {
  const onLine = (line: string) => {
    const match = TUNNEL_URL.exec(line);
    if (match === null) return;
    input.state.publicUrl = match[0];
    input.clear();
    input.settle({ kind: "url", url: match[0] });
  };
  input.proc.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) onLine(line);
  });
  input.proc.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) onLine(line);
  });
};

const attachTunnelLifecycle = (input: {
  proc: ChildProcess;
  state: TunnelWaitState;
  settle: (outcome: TunnelSettle) => void;
  clear: () => void;
}): void => {
  input.proc.on("error", (err) => {
    input.clear();
    input.settle({ kind: "error", error: err });
  });
  input.proc.on("exit", (code) => {
    input.clear();
    if (code !== 0 && input.state.publicUrl.length === 0) {
      input.settle({
        kind: "error",
        error: new Error(`cloudflared exited with code ${code}`),
      });
    }
  });
};

const waitForTunnelUrl = (proc: ChildProcess): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const state: TunnelWaitState = { publicUrl: "", settled: false };
    const settle = (outcome: TunnelSettle) => {
      if (state.settled) return;
      state.settled = true;
      if (outcome.kind === "error") {
        reject(outcome.error);
        return;
      }
      resolve(outcome.url);
    };
    const timeout = setTimeout(() => {
      settle({ kind: "error", error: new Error("Timed out waiting for tunnel URL") });
    }, TUNNEL_URL_TIMEOUT_MS);
    const clear = () => clearTimeout(timeout);
    attachTunnelOutput({ proc, state, settle, clear });
    attachTunnelLifecycle({ proc, state, settle, clear });
  });
};

/** Process handle that manages one Cloudflare Tunnel subprocess. */
export class CloudflareTunnel {
  private proc: ChildProcess | null = null;
  private publicUrl = "";

  async start(localPort: number): Promise<string> {
    this.proc = spawnCloudflared(localPort);
    this.publicUrl = await waitForTunnelUrl(this.proc);
    return this.publicUrl;
  }

  getUrl(): string {
    return this.publicUrl;
  }

  stop(): void {
    if (this.proc === null) return;
    this.proc.kill("SIGTERM");
    this.proc = null;
  }
}
