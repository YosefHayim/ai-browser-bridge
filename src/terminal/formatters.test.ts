import { describe, expect, it } from "vitest";
import type { SessionMetadata } from "@/store/session-store.ts";
import { createSessionSummary, readMcpConnectorUrl } from "./cli-operations.ts";

describe("mcpConnectorUrl", () => {
  it("returns null when no tunnel is configured", () => {
    expect(readMcpConnectorUrl(undefined)).toBeNull();
    expect(readMcpConnectorUrl("")).toBeNull();
  });

  it("appends /mcp to a bare tunnel URL and trims trailing slashes", () => {
    expect(readMcpConnectorUrl("https://x.trycloudflare.com")).toBe(
      "https://x.trycloudflare.com/mcp",
    );
    expect(readMcpConnectorUrl("https://x.trycloudflare.com/")).toBe(
      "https://x.trycloudflare.com/mcp",
    );
  });

  it("leaves an existing /mcp or /sse endpoint untouched", () => {
    expect(readMcpConnectorUrl("https://x.trycloudflare.com/mcp")).toBe(
      "https://x.trycloudflare.com/mcp",
    );
    expect(readMcpConnectorUrl("https://x.trycloudflare.com/sse")).toBe(
      "https://x.trycloudflare.com/sse",
    );
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
    expect(createSessionSummary(base, "s1")).toContain("Local session current: s1");
  });

  it("marks other sessions as loaded and renders a missing tunnel as none", () => {
    const out = createSessionSummary(base, "other");
    expect(out).toContain("Local session loaded: s1");
    expect(out).toContain("Tunnel: none");
  });
});
