import type { AskToolReport } from "@/agent-gateway/agent-gateway-schemas.ts";
import { readErrorMessage } from "@/read-error-message.ts";

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

// A thrown error becomes the same MCP error reply a failed tool report gives, so no handler rejects.
export function readMcpFailureReply(error: unknown) {
  return {
    content: [{ type: "text" as const, text: readErrorMessage(error) }],
    isError: true,
  };
}
