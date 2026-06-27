import { spawn, type ChildProcess } from "node:child_process";

interface TunnelWireState {
  publicUrl: string;
  settled: boolean;
}

interface WireTunnelInput {
  state: TunnelWireState;
  settle: (result: { url?: string; error?: Error }) => void;
}

/** Wire cloudflared stdout/stderr and lifecycle handlers for tunnel URL discovery. */
export function wireTunnelProcess(proc: ChildProcess, input: WireTunnelInput): void {
  const timeout = setTimeout(() => {
    input.settle({ error: new Error("Timed out waiting for tunnel URL") });
  }, 30_000);
  const clear = () => clearTimeout(timeout);
  attachTunnelOutput({ proc, state: input.state, settle: input.settle, clear });
  attachTunnelLifecycle({ proc, state: input.state, settle: input.settle, clear });
}

function attachTunnelOutput(input: {
  proc: ChildProcess;
  state: TunnelWireState;
  settle: WireTunnelInput["settle"];
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

function attachTunnelLifecycle(input: {
  proc: ChildProcess;
  state: TunnelWireState;
  settle: WireTunnelInput["settle"];
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

/** Spawn cloudflared for a local HTTP port. */
export function spawnCloudflared(localPort: number): ChildProcess {
  return spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
