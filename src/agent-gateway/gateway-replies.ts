import type { AskToolReport } from "@/agent-gateway/agent-gateway-schemas.ts";

// JSON.stringify(undefined) is undefined; MCP text content needs a real string.
export function readGatewayDocumentPrintout(toolReport: unknown): string {
  const encoded = JSON.stringify(toolReport);

  const isEncodedMissing = encoded == null;
  if (isEncodedMissing) return "null";

  return encoded;
}

export function readMcpReplyMessage(gatewayReply: AskToolReport) {
  return {
    content: [{ type: "text" as const, text: gatewayReply.output }],
    isError: !gatewayReply.ok,
  };
}
