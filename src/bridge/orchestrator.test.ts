import type { Page } from "playwright";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BridgeSettings } from "@/domain/bridge-types.ts";
import type { BrowserProvider } from "@/providers/browser-provider.ts";
import { readProvider } from "@/providers/providers.ts";
import { Orchestrator } from "./orchestrator.ts";

const CONNECTOR_URL = "https://bridge.example.test/mcp";

const bridgeSettings: BridgeSettings = {
  repoPath: "/repo",
  mcpPort: 8765,
  contextLimit: 100_000,
};

const createFakePage = (): { page: Page; goto: ReturnType<typeof vi.fn> } => {
  const goto = vi.fn(async () => null);
  const page = { goto } as unknown as Page;
  return { page, goto };
};

const createChatGptOrchestrator = (): { orchestrator: Orchestrator; provider: BrowserProvider } => {
  const provider = readProvider("chatgpt");
  const orchestrator = new Orchestrator(bridgeSettings, provider);
  return { orchestrator, provider };
};

// The setup deadline is AbortSignal.timeout, which ignores fake timers; the test aborts this controller instead.
const stubConnectorSetupDeadline = (): AbortController => {
  const deadlineController = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadlineController.signal);
  return deadlineController;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Orchestrator.openConnectorSetup", () => {
  test("openConnectorSetup reports needs attention when the setup never finishes", async () => {
    const deadlineController = stubConnectorSetupDeadline();
    const { orchestrator, provider } = createChatGptOrchestrator();
    vi.spyOn(provider, "setupMcpConnector").mockReturnValue(new Promise<never>(() => {}));
    const { page } = createFakePage();
    orchestrator.setPage(page);

    const setupReportPromise = orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });
    deadlineController.abort();
    const setupReport = await setupReportPromise;

    expect(setupReport.completed).toBe(false);
    expect(setupReport.warnings.join(" ")).toContain("did not finish within 120 seconds");
  });

  test("openConnectorSetup stops a slow setup before its next step after the deadline", async () => {
    const deadlineController = stubConnectorSetupDeadline();
    const { orchestrator, provider } = createChatGptOrchestrator();
    const stepsRun: string[] = [];
    vi.spyOn(provider, "setupMcpConnector").mockImplementation(
      async (_page, _url, setupSettings) => {
        stepsRun.push("first step");
        await new Promise<void>((finishSlowStep) => {
          setupSettings?.signal?.addEventListener("abort", () => finishSlowStep(), { once: true });
        });
        setupSettings?.signal?.throwIfAborted();
        stepsRun.push("second step");
        return { connectorUrl: CONNECTOR_URL, completed: true, steps: [], warnings: [] };
      },
    );
    const { page } = createFakePage();
    orchestrator.setPage(page);

    const setupReportPromise = orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });
    deadlineController.abort();
    const setupReport = await setupReportPromise;

    expect(setupReport.completed).toBe(false);
    expect(stepsRun).toEqual(["first step"]);
  });

  test("openConnectorSetup returns the tab to the provider default URL after a failed setup", async () => {
    const { orchestrator, provider } = createChatGptOrchestrator();
    vi.spyOn(provider, "setupMcpConnector").mockRejectedValue(
      new Error("Could not find the connector URL field."),
    );
    const { page, goto } = createFakePage();
    orchestrator.setPage(page);

    const setupReport = await orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });

    expect(setupReport.completed).toBe(false);
    expect(setupReport.warnings).toEqual(["Could not find the connector URL field."]);
    expect(goto).toHaveBeenLastCalledWith(provider.defaultUrl, {
      waitUntil: "domcontentloaded",
    });
  });
});
