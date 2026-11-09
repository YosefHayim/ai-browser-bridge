import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type BrowserMcpOperations, createBrowserMcpServer } from "./browserMcpServer.ts";

// Test support: a real MCP client wired to the gateway over an in-memory transport.
export const connectMcpClient = async (deps: BrowserMcpOperations) => {
  const mcpServer = createBrowserMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcpServer };
};

// Test support: for gateways whose test never fans out.
export const unusedFanOut: BrowserMcpOperations["fanOut"] = async () => {
  throw new Error("fan-out is not part of this test");
};
