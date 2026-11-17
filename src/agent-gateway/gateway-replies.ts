import type { AskToolReport } from "@/agent-gateway/agent-gateway-schemas.ts";

// JSON.stringify(undefined) is undefined; MCP text content needs a real string.
export const readGatewayDocumentPrintout = (toolReport: unknown): string => {
  const encoded = JSON.stringify(toolReport);

  const isEncodedMissing = encoded == null;
  if (isEncodedMissing) return "null";

  return encoded;
};

export const readMcpReplyMessage = (gatewayReply: AskToolReport) => ({
  content: [{ type: "text" as const, text: gatewayReply.output }],
  isError: !gatewayReply.ok,
});
