import { type ChildProcess, spawn } from "node:child_process";

const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const TUNNEL_URL_TIMEOUT_MS = 30_000;

const spawnCloudflared = (localPort: number): ChildProcess =>
  spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

type TunnelWaitEnd =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "error"; readonly error: Error };

type TunnelWaitStatus = {
  publicUrl: string | null;
  settled: boolean;
};

type TunnelWaitHandlers = {
  readonly cloudflared: ChildProcess;
  readonly state: TunnelWaitStatus;
  readonly settle: (waitEnd: TunnelWaitEnd) => void;
  readonly clearUrlTimeout: () => void;
};

const readPublicUrlFromLine = (line: string): string | null => {
  const urlParts = TRYCLOUDFLARE_URL.exec(line);
  const isUrlMissing = urlParts == null;
  if (isUrlMissing) return null;

  return urlParts[0];
};

const attachTunnelPrintout = (handlers: TunnelWaitHandlers): void => {
  const settleTunnelUrlFromChunk = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const publicUrl = readPublicUrlFromLine(line);

      const isPublicUrlMissing = publicUrl == null;
      if (isPublicUrlMissing) continue;

      handlers.state.publicUrl = publicUrl;
      handlers.clearUrlTimeout();
      handlers.settle({ kind: "url", url: publicUrl });
    }
  };

  const stdout = handlers.cloudflared.stdout;

  const stderr = handlers.cloudflared.stderr;
  const isStdoutOrStderrMissing = stdout == null || stderr == null;
  if (isStdoutOrStderrMissing) {
    handlers.clearUrlTimeout();
    handlers.settle({
      kind: "error",
      error: new Error("cloudflared stdio pipes were not created"),
    });
    return;
  }

  stdout.on("data", settleTunnelUrlFromChunk);
  stderr.on("data", settleTunnelUrlFromChunk);
};

const attachTunnelLifecycle = (handlers: TunnelWaitHandlers): void => {
  handlers.cloudflared.on("error", (spawnError) => {
    handlers.clearUrlTimeout();
    handlers.settle({ kind: "error", error: spawnError });
  });
  handlers.cloudflared.on("exit", (exitCode) => {
    handlers.clearUrlTimeout();

    const isSuccessfulExit = exitCode === 0;
    if (isSuccessfulExit) return;

    if (handlers.state.publicUrl != null) return;

    handlers.settle({
      kind: "error",
      error: new Error(`cloudflared exited with code ${exitCode}`),
    });
  });
};

const waitForTunnelUrl = (cloudflared: ChildProcess): Promise<string> =>
  new Promise<string>((fulfill, reject) => {
    const status: TunnelWaitStatus = { publicUrl: null, settled: false };
    const settle = (waitEnd: TunnelWaitEnd) => {
      if (status.settled) return;

      status.settled = true;

      const isKindError = waitEnd.kind === "error";
      if (isKindError) {
        reject(waitEnd.error);
        return;
      }

      fulfill(waitEnd.url);
    };
    const urlTimeout = setTimeout(() => {
      const timeoutError = new Error("Timed out waiting for tunnel URL");
      settle({ kind: "error", error: timeoutError });
    }, TUNNEL_URL_TIMEOUT_MS);
    const clearUrlTimeout = () => clearTimeout(urlTimeout);
    const handlers: TunnelWaitHandlers = {
      cloudflared,
      state: status,
      settle,
      clearUrlTimeout,
    };
    attachTunnelPrintout(handlers);
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
    if (this.cloudflared == null) return;

    this.cloudflared.kill("SIGTERM");
    this.cloudflared = undefined;
  }
}
