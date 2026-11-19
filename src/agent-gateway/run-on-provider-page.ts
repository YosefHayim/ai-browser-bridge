import type { Page } from "playwright";
import type { AskToolReport } from "@/agent-gateway/agent-gateway-schemas.ts";
import type { AskGatewayCollaborators } from "@/agent-gateway/ask-gateway.ts";
import { readGatewayDocumentPrintout } from "@/agent-gateway/gateway-replies.ts";
import { readErrorMessage } from "@/read-error-message.ts";

type GatewayPageProviderId = "chatgpt" | "flow" | "design";

type PageRunner = AskGatewayCollaborators["withChatGptPage"];

function readPageRunner(
  collaborators: AskGatewayCollaborators,
  providerId: GatewayPageProviderId,
): PageRunner {
  switch (providerId) {
    case "chatgpt":
      return collaborators.withChatGptPage;
    case "flow":
      return collaborators.withFlowPage;
    case "design":
      return collaborators.withDesignPage;
  }
}

function readUnavailableMessage(providerId: GatewayPageProviderId): string {
  switch (providerId) {
    case "chatgpt":
      return "ChatGPT tools are not available in this gateway (no browser-backed ChatGPT session).";
    case "flow":
      return "Flow tools are not available in this gateway (no browser-backed Flow session).";
    case "design":
      return "Claude Design tools are not available in this gateway (no browser session).";
  }
}

export async function runOnProviderPage<Reply>(
  collaborators: AskGatewayCollaborators,
  providerId: GatewayPageProviderId,
  runOnPage: (page: Page) => Promise<Reply>,
): Promise<AskToolReport> {
  const withPage = readPageRunner(collaborators, providerId);

  const isPageRunnerMissing = withPage == null;
  if (isPageRunnerMissing) return { ok: false, output: readUnavailableMessage(providerId) };

  try {
    const pageReport = await withPage(runOnPage);
    return { ok: true, output: readGatewayDocumentPrintout(pageReport) };
  } catch (error) {
    return { ok: false, output: readErrorMessage(error) };
  }
}
