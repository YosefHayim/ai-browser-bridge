import { describe, expect, it } from "vitest";
import { readMcpConnectorUrl } from "./project-task-prompt.ts";

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
