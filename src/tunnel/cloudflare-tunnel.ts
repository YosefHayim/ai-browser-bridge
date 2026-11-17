import { type ChildProcess, spawn } from "node:child_process";

const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const TUNNEL_URL_TIMEOUT_MILLISECONDS = 30_000;
const PIPE_STDIO_MODE = "pipe";
const CHUNK_EVENT = "data";
const ERROR_EVENT = "error";
const ERROR_WAIT_END_KIND = "error";

function spawnCloudflared(localPort: number): ChildProcess {
  return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", PIPE_STDIO_MODE, PIPE_STDIO_MODE],
  });
}

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

function readPublicUrlFromLine(line: string): string | null {
  const urlParts = TRYCLOUDFLARE_URL.exec(line);

  const isUrlMissing = urlParts == null;
  if (isUrlMissing) return null;

  return urlParts[0];
}

function attachTunnelPrintout(handlers: TunnelWaitHandlers): void {
  function settleTunnelUrlFromChunk(chunk: Buffer) {
    for (const line of chunk.toString().split("\n")) {
      const publicUrl = readPublicUrlFromLine(line);

      const isPublicUrlMissing = publicUrl == null;
      if (isPublicUrlMissing) continue;

      handlers.state.publicUrl = publicUrl;
      handlers.clearUrlTimeout();
      handlers.settle({ kind: "url", url: publicUrl });
    }
  }

  const stdout = handlers.cloudflared.stdout;

  const stderr = handlers.cloudflared.stderr;

  const isStdoutOrStderrMissing = stdout == null || stderr == null;
  if (isStdoutOrStderrMissing) {
    const pipesMissingError = new Error("cloudflared stdio pipes were not created");

    handlers.clearUrlTimeout();
    handlers.settle({ kind: ERROR_WAIT_END_KIND, error: pipesMissingError });
    return;
  }

  stdout.on(CHUNK_EVENT, settleTunnelUrlFromChunk);
  stderr.on(CHUNK_EVENT, settleTunnelUrlFromChunk);
}

function attachTunnelLifecycle(handlers: TunnelWaitHandlers): void {
  handlers.cloudflared.on(ERROR_EVENT, (spawnError) => {
    handlers.clearUrlTimeout();
    handlers.settle({ kind: ERROR_WAIT_END_KIND, error: spawnError });
  });
  handlers.cloudflared.on("exit", (exitCode) => {
    handlers.clearUrlTimeout();

    const isSuccessfulExit = exitCode === 0;
    if (isSuccessfulExit) return;

    const hasPublicUrl = handlers.state.publicUrl != null;
    if (hasPublicUrl) return;

    const exitedEarlyError = new Error(`cloudflared exited with code ${exitCode}`);
    handlers.settle({ kind: ERROR_WAIT_END_KIND, error: exitedEarlyError });
  });
}

function waitForTunnelUrl(cloudflared: ChildProcess): Promise<string> {
  return new Promise<string>((fulfill, reject) => {
    const status: TunnelWaitStatus = { publicUrl: null, settled: false };
    function settle(waitEnd: TunnelWaitEnd) {
      const isSettled = status.settled;
      if (isSettled) return;

      status.settled = true;

      const isErrorWaitEnd = waitEnd.kind === ERROR_WAIT_END_KIND;
      if (isErrorWaitEnd) {
        reject(waitEnd.error);
        return;
      }

      fulfill(waitEnd.url);
    }

    const urlTimeout = setTimeout(() => {
      const timeoutError = new Error("Timed out waiting for tunnel URL");
      settle({ kind: ERROR_WAIT_END_KIND, error: timeoutError });
    }, TUNNEL_URL_TIMEOUT_MILLISECONDS);
    function clearUrlTimeout() {
      return clearTimeout(urlTimeout);
    }

    const handlers: TunnelWaitHandlers = {
      cloudflared,
      state: status,
      settle,
      clearUrlTimeout,
    };

    attachTunnelPrintout(handlers);
    attachTunnelLifecycle(handlers);
  });
}

export interface CloudflareTunnel {
  readonly publicUrl: string;
  stop: () => void;
}

export async function startCloudflareTunnel(localPort: number): Promise<CloudflareTunnel> {
  const cloudflared = spawnCloudflared(localPort);
  function stopTunnel(): void {
    process.off("exit", stopTunnel);
    cloudflared.kill("SIGTERM");
  }

  // A bridge that exits without shutDown (a crash or process.exit) would leave cloudflared running.
  process.on("exit", stopTunnel);

  try {
    const publicUrl = await waitForTunnelUrl(cloudflared);
    return { publicUrl, stop: stopTunnel };
  } catch (error) {
    stopTunnel();
    throw error;
  }
}
