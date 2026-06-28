import { describe, expect, it } from "vitest";
import { formatSessionSummary, mcpConnectorUrl } from "../../../src/features/terminal/cli-runner.class.ts";
import type { SessionMetadata } from "../../../src/features/store/session-store.ts";

describe("mcpConnectorUrl", () => {
  it("returns null when no tunnel is configured", () => {
    expect(mcpConnectorUrl(undefined)).toBeNull();
    expect(mcpConnectorUrl("")).toBeNull();
  });

  it("appends /mcp to a bare tunnel URL and trims trailing slashes", () => {
    expect(mcpConnectorUrl("https://x.trycloudflare.com")).toBe("https://x.trycloudflare.com/mcp");
    expect(mcpConnectorUrl("https://x.trycloudflare.com/")).toBe("https://x.trycloudflare.com/mcp");
  });

  it("leaves an existing /mcp or /sse endpoint untouched", () => {
    expect(mcpConnectorUrl("https://x.trycloudflare.com/mcp")).toBe("https://x.trycloudflare.com/mcp");
    expect(mcpConnectorUrl("https://x.trycloudflare.com/sse")).toBe("https://x.trycloudflare.com/sse");
  });
});

describe("formatSessionSummary", () => {
  const base: SessionMetadata = {
    id: "s1",
    repoPath: "/repo",
    model: "GPT-5.2",
    contextLimit: 128_000,
    tunnelUrl: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  it("marks the active session as current", () => {
    expect(formatSessionSummary(base, "s1")).toContain("Local session current: s1");
  });

  it("marks other sessions as loaded and renders a missing tunnel as none", () => {
    const out = formatSessionSummary(base, "other");
    expect(out).toContain("Local session loaded: s1");
    expect(out).toContain("Tunnel: none");
  });
});
