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

type FakeTab = {
  page: Page;
  goto: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const createFakeTab = (): FakeTab => {
  const goto = vi.fn(async () => null);
  const close = vi.fn(async () => undefined);
  const page = { goto, close } as unknown as Page;
  return { page, goto, close };
};

// The chat tab opens one new tab for each connector setup, like a real browser context does.
const createFakeChatTab = (): { chatPage: Page; chatTab: FakeTab; setupTab: FakeTab } => {
  const chatTab = createFakeTab();
  const setupTab = createFakeTab();
  const context = { newPage: vi.fn(async () => setupTab.page) };
  const chatPage = { goto: chatTab.goto, context: () => context } as unknown as Page;
  return { chatPage, chatTab, setupTab };
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
  test("openConnectorSetup runs the setup in a new tab and leaves the chat tab alone", async () => {
    const { orchestrator, provider } = createChatGptOrchestrator();
    const setupMcpConnector = vi.spyOn(provider, "setupMcpConnector").mockResolvedValue({
      connectorUrl: CONNECTOR_URL,
      completed: true,
      steps: [],
      warnings: [],
    });
    const { chatPage, chatTab, setupTab } = createFakeChatTab();
    orchestrator.setPage(chatPage);

    await orchestrator.openConnectorSetup({ connectorUrl: CONNECTOR_URL, automatic: true });

    expect(setupMcpConnector).toHaveBeenCalledWith(setupTab.page, CONNECTOR_URL, expect.anything());
    expect(chatTab.goto).not.toHaveBeenCalled();
  });

  test("openConnectorSetup closes the setup tab after a successful setup", async () => {
    const { orchestrator, provider } = createChatGptOrchestrator();
    vi.spyOn(provider, "setupMcpConnector").mockResolvedValue({
      connectorUrl: CONNECTOR_URL,
      completed: true,
      steps: [],
      warnings: [],
    });
    const { chatPage, setupTab } = createFakeChatTab();
    orchestrator.setPage(chatPage);

    const setupReport = await orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });

    expect(setupReport.completed).toBe(true);
    expect(setupTab.close).toHaveBeenCalledTimes(1);
  });

  test("openConnectorSetup reports needs attention and closes the setup tab when the setup never finishes", async () => {
    const deadlineController = stubConnectorSetupDeadline();
    const { orchestrator, provider } = createChatGptOrchestrator();
    vi.spyOn(provider, "setupMcpConnector").mockReturnValue(new Promise<never>(() => {}));
    const { chatPage, setupTab } = createFakeChatTab();
    orchestrator.setPage(chatPage);

    const setupReportPromise = orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });
    deadlineController.abort();
    const setupReport = await setupReportPromise;

    expect(setupReport.completed).toBe(false);
    expect(setupReport.warnings.join(" ")).toContain("did not finish within 120 seconds");
    expect(setupTab.close).toHaveBeenCalledTimes(1);
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
    const { chatPage } = createFakeChatTab();
    orchestrator.setPage(chatPage);

    const setupReportPromise = orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });
    deadlineController.abort();
    const setupReport = await setupReportPromise;

    expect(setupReport.completed).toBe(false);
    expect(stepsRun).toEqual(["first step"]);
  });

  test("openConnectorSetup closes the setup tab after a failed setup and reports the reason", async () => {
    const { orchestrator, provider } = createChatGptOrchestrator();
    vi.spyOn(provider, "setupMcpConnector").mockRejectedValue(
      new Error("Could not find the connector URL field."),
    );
    const { chatPage, chatTab, setupTab } = createFakeChatTab();
    orchestrator.setPage(chatPage);

    const setupReport = await orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });

    expect(setupReport.completed).toBe(false);
    expect(setupReport.warnings).toEqual(["Could not find the connector URL field."]);
    expect(setupTab.close).toHaveBeenCalledTimes(1);
    expect(chatTab.goto).not.toHaveBeenCalled();
  });
});

describe("Orchestrator.sendPrompt", () => {
  test("sendPrompt does not wait for a connector setup that is still running", async () => {
    const deadlineController = stubConnectorSetupDeadline();
    const { orchestrator, provider } = createChatGptOrchestrator();
    vi.spyOn(provider, "setupMcpConnector").mockReturnValue(new Promise<never>(() => {}));
    vi.spyOn(provider, "countAssistantReplies").mockResolvedValue(0);
    vi.spyOn(provider, "captureLastReply").mockResolvedValue("ready");
    vi.spyOn(provider, "injectPrompt").mockResolvedValue();
    vi.spyOn(provider, "waitForReply").mockResolvedValue();
    const { chatPage } = createFakeChatTab();
    orchestrator.setPage(chatPage);

    const pendingSetupPromise = orchestrator.openConnectorSetup({
      connectorUrl: CONNECTOR_URL,
      automatic: true,
    });
    const replyMessage = await orchestrator.sendPrompt({ content: "Reply with the word ready" });
    deadlineController.abort();
    await pendingSetupPromise;

    expect(replyMessage?.content).toBe("ready");
  });
});
