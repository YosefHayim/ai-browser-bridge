import { type ChildProcess, spawn } from "node:child_process";

const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const TUNNEL_URL_TIMEOUT_MS = 30_000;

const spawnCloudflared = (localPort: number): ChildProcess =>
  spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

type TunnelWaitOutcome =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "error"; readonly error: Error };

type TunnelWaitState = {
  publicUrl: string | undefined;
  settled: boolean;
};

type TunnelWaitHandlers = {
  readonly cloudflared: ChildProcess;
  readonly state: TunnelWaitState;
  readonly settle: (outcome: TunnelWaitOutcome) => void;
  readonly clearUrlTimeout: () => void;
};

const publicUrlFromLine = (line: string): string | undefined => {
  const match = TRYCLOUDFLARE_URL.exec(line);
  if (match === null) return undefined;
  return match[0];
};

const attachTunnelOutput = (handlers: TunnelWaitHandlers): void => {
  const onChunk = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const publicUrl = publicUrlFromLine(line);
      if (publicUrl === undefined) continue;
      handlers.state.publicUrl = publicUrl;
      handlers.clearUrlTimeout();
      handlers.settle({ kind: "url", url: publicUrl });
    }
  };

  const stdout = handlers.cloudflared.stdout;
  const stderr = handlers.cloudflared.stderr;
  if (stdout === null || stderr === null) {
    handlers.clearUrlTimeout();
    handlers.settle({
      kind: "error",
      error: new Error("cloudflared stdio pipes were not created"),
    });
    return;
  }

  stdout.on("data", onChunk);
  stderr.on("data", onChunk);
};

const attachTunnelLifecycle = (handlers: TunnelWaitHandlers): void => {
  handlers.cloudflared.on("error", (spawnError) => {
    handlers.clearUrlTimeout();
    handlers.settle({ kind: "error", error: spawnError });
  });
  handlers.cloudflared.on("exit", (exitCode) => {
    handlers.clearUrlTimeout();
    if (exitCode === 0) return;
    if (handlers.state.publicUrl !== undefined) return;
    handlers.settle({
      kind: "error",
      error: new Error(`cloudflared exited with code ${exitCode}`),
    });
  });
};

const waitForTunnelUrl = (cloudflared: ChildProcess): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const state: TunnelWaitState = { publicUrl: undefined, settled: false };
    const settle = (outcome: TunnelWaitOutcome) => {
      if (state.settled) return;
      state.settled = true;
      if (outcome.kind === "error") {
        reject(outcome.error);
        return;
      }
      resolve(outcome.url);
    };
    const urlTimeout = setTimeout(() => {
      settle({ kind: "error", error: new Error("Timed out waiting for tunnel URL") });
    }, TUNNEL_URL_TIMEOUT_MS);
    const clearUrlTimeout = () => clearTimeout(urlTimeout);
    const handlers: TunnelWaitHandlers = {
      cloudflared,
      state,
      settle,
      clearUrlTimeout,
    };
    attachTunnelOutput(handlers);
    attachTunnelLifecycle(handlers);
  });

export class CloudflareTunnel {
  private cloudflared: ChildProcess | undefined;
  private publicUrl = "";

  async start(localPort: number): Promise<string> {
    this.cloudflared = spawnCloudflared(localPort);
    this.publicUrl = await waitForTunnelUrl(this.cloudflared);
    return this.publicUrl;
  }

  getUrl(): string {
    return this.publicUrl;
  }

  stop(): void {
    if (this.cloudflared === undefined) return;
    this.cloudflared.kill("SIGTERM");
    this.cloudflared = undefined;
  }
}
