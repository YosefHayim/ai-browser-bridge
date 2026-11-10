import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type AskGatewayCollaborators, askGatewayServerFor } from "./ask-gateway-server.ts";

// Test support: a real MCP client wired to the gateway over an in-memory transport.
export const connectGatewayClient = async (collaborators: AskGatewayCollaborators) => {
  const mcpServer = askGatewayServerFor(collaborators);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcpServer };
};

// Test support: for gateways whose test never fans out.
export const createUnusedFanOut: AskGatewayCollaborators["fanOut"] = async () => {
  throw new Error("fan-out is not part of this test");
};
