import { spawn, type ChildProcess } from "node:child_process";

/** Manages a Cloudflare Tunnel (cloudflared) that exposes a local port over HTTPS. */
export class CloudflareTunnel {
  private proc: ChildProcess | null = null;
  private publicUrl = "";

  /** Start the tunnel, returning the public HTTPS URL. */
  async start(localPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.proc = spawn("cloudflared", [
        "tunnel",
        "--url",
        `http://localhost:${localPort}`,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for tunnel URL"));
      }, 30_000);

      const onLine = (line: string) => {
        const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
          this.publicUrl = match[0];
          clearTimeout(timeout);
          resolve(this.publicUrl);
        }
      };

      this.proc.stdout?.on("data", (d: Buffer) => {
        const text = d.toString();
        for (const line of text.split("\n")) {
          onLine(line);
        }
      });

      this.proc.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        for (const line of text.split("\n")) {
          onLine(line);
        }
      });

      this.proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.proc.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !this.publicUrl) {
          reject(new Error(`cloudflared exited with code ${code}`));
        }
      });
    });
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
