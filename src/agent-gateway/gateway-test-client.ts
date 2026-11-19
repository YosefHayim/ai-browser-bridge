import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AskGateway, type AskGatewayCollaborators } from "@/agent-gateway/ask-gateway.ts";

export async function connectGatewayClient(collaborators: AskGatewayCollaborators) {
  const mcpServer = new AskGateway(collaborators).createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcpServer };
}

export const createUnusedFanOut: AskGatewayCollaborators["fanOut"] = async () => {
  throw new Error("fan-out is not part of this test");
};
