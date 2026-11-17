import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway-server.ts";
import { createAskGatewayServer } from "@/agent-gateway/ask-gateway-server.ts";
import { toolRegistry } from "@/repo-tools-mcp/mcp-server.ts";

type ToolDirection = "served-to-chat-app" | "served-to-agents";

export interface CatalogTool {
  name: string;
  description: string;
  signature: string;
  direction: ToolDirection;
}

interface ToolInputSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

function createSignature(toolName: string, inputSchema: ToolInputSchema): string {
  const requiredNames = new Set(inputSchema.required ?? []);
  const argumentNames = Object.keys(inputSchema.properties ?? {});
  const hasNoArguments = argumentNames.length === 0;
  if (hasNoArguments) return `${toolName}()`;

  const shownNames = argumentNames.map((name) => (requiredNames.has(name) ? name : `${name}?`));

  return `${toolName}({ ${shownNames.join(", ")} })`;
}

function readRepoTools(): CatalogTool[] {
  return [...toolRegistry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    signature: createSignature(tool.name, z.toJSONSchema(tool.argsSchema)),
    direction: "served-to-chat-app",
  }));
}

async function readGatewayTools(): Promise<CatalogTool[]> {
  const gatewayServer = createAskGatewayServer({} as AskGatewayCollaborators);
  const client = new Client({ name: "site-build", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([gatewayServer.connect(serverTransport), client.connect(clientTransport)]);

  const toolList = await client.listTools();
  await client.close();
  await gatewayServer.close();

  return toolList.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    signature: createSignature(tool.name, tool.inputSchema as ToolInputSchema),
    direction: "served-to-agents",
  }));
}

export async function readToolCatalog(): Promise<CatalogTool[]> {
  return [...(await readGatewayTools()), ...readRepoTools()];
}
