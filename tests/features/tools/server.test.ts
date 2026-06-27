import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { isSseEndpointPath, isStreamableHttpEndpointPath, startMcpServer } from "../../../src/features/tools/server.ts";

describe("MCP server", () => {
  it("accepts common SSE endpoint paths", () => {
    expect(isSseEndpointPath("/")).toBe(true);
    expect(isSseEndpointPath("/sse")).toBe(true);
    expect(isSseEndpointPath("/sse/")).toBe(true);
    expect(isSseEndpointPath("/messages")).toBe(false);
  });

  it("accepts the streamable HTTP endpoint path", () => {
    expect(isStreamableHttpEndpointPath("/mcp")).toBe(true);
    expect(isStreamableHttpEndpointPath("/mcp/")).toBe(true);
    expect(isStreamableHttpEndpointPath("/sse")).toBe(false);
  });

  it.each(["/", "/sse", "/sse/"])("exposes local bridge tools through %s", async (path) => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bridge-mcp-server-"));
    const port = await getFreePort();
    const server = await startMcpServer(repoRoot, port);
    const client = new Client({ name: "bridge-test", version: "0.0.0" });
    const transport = new SSEClientTransport(new URL(path, `${server.url}/`));

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "grep_code",
        "read_file",
        "apply_patch",
        "run_tests",
        "git_diff",
      ]));
    } finally {
      await client.close();
      server.close();
    }
  });

  it("supports multiple active SSE clients without reusing one protocol transport", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bridge-mcp-server-"));
    const port = await getFreePort();
    const server = await startMcpServer(repoRoot, port);
    const firstClient = new Client({ name: "bridge-test-a", version: "0.0.0" });
    const secondClient = new Client({ name: "bridge-test-b", version: "0.0.0" });

    try {
      await Promise.all([
        firstClient.connect(new SSEClientTransport(new URL("/sse", `${server.url}/`))),
        secondClient.connect(new SSEClientTransport(new URL("/sse", `${server.url}/`))),
      ]);

      const [firstTools, secondTools] = await Promise.all([
        firstClient.listTools(),
        secondClient.listTools(),
      ]);
      expect(firstTools.tools.map((tool) => tool.name)).toContain("read_file");
      expect(secondTools.tools.map((tool) => tool.name)).toContain("grep_code");
    } finally {
      await Promise.allSettled([firstClient.close(), secondClient.close()]);
      server.close();
    }
  });

  it("exposes local bridge tools through streamable HTTP", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bridge-mcp-server-"));
    const port = await getFreePort();
    const server = await startMcpServer(repoRoot, port);
    const client = new Client({ name: "bridge-streamable-test", version: "0.0.0" });

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", `${server.url}/`)));
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        "grep_code",
        "read_file",
        "apply_patch",
        "run_tests",
        "git_diff",
      ]));
      expect(tools.tools.find((tool) => tool.name === "read_file")?.annotations).toMatchObject({
        readOnlyHint: true,
      });
      expect(tools.tools.find((tool) => tool.name === "apply_patch")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
    } finally {
      await client.close();
      server.close();
    }
  });
});

async function getFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolvePromise(address.port));
    });
  });
}
