import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type AskGatewayCollaborators, createAskGatewayServer } from "./ask-gateway-server.ts";

export const connectGatewayClient = async (collaborators: AskGatewayCollaborators) => {
  const mcpServer = createAskGatewayServer(collaborators);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcpServer };
};

export const createUnusedFanOut: AskGatewayCollaborators["fanOut"] = async () => {
  throw new Error("fan-out is not part of this test");
};
