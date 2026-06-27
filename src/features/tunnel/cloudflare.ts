import type { ChildProcess } from "node:child_process";
import { spawnCloudflared } from "./cloudflare.wire.ts";
import { waitForTunnelUrl } from "./cloudflare.wait.ts";

/** Manages a Cloudflare Tunnel (cloudflared) that exposes a local port over HTTPS. */
export class CloudflareTunnel {
  private proc: ChildProcess | null = null;
  private publicUrl = "";

  /** Start the tunnel, returning the public HTTPS URL. */
  async start(localPort: number): Promise<string> {
    this.proc = spawnCloudflared(localPort);
    this.publicUrl = await waitForTunnelUrl(this.proc);
    return this.publicUrl;
  }

  /** Get the current public URL (empty string if not started). */
  get url(): string {
    return this.publicUrl;
  }

  /** Stop the tunnel. */
  stop(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }
}
