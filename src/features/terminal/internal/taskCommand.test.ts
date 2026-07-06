import type { CommandContext } from "@/features/domain/types.ts";
import { describe, expect, it, vi } from "vitest";
import { getMessageRoleTheme, shouldAutoWrapProjectPrompt } from "../tui/App.tsx";
import { buildProjectTaskPrompt, executeCommand } from "./cliRunner.ts";

const createCommandContext = (onSend: (content: string) => void): CommandContext => {
  return {
    config: {
      repoPath: "/tmp/project",
      mcpPort: 8765,
      contextLimit: 128_000,
      model: "GPT-5.3 Instant",
    },
    messages: [],
    sendMessage: async (content: string) => {
      onSend(content);
    },
    counter: {
      count: 0,
      contextLimit: 128_000,
      modelLabel: "GPT-5.3 Instant",
      summary: "~0 / 128,000 (0.0%)",
      setModel: () => {},
    },
    orchestrator: {
      listConversations: async () => [],
      searchConversations: async () => [],
      navigateToConversation: async () => {},
      newConversation: async () => {},
      model: "GPT-5.3 Instant",
      detectModel: async () => "GPT-5.3 Instant",
      listModels: async () => [],
      switchModel: async () => "GPT-5.3 Instant",
      rewindLastPrompt: async () => {},
      stopResponse: async () => false,
      openConnectorSetup: undefined,
    },
  };
};

describe("task command", () => {
  it("builds a project-agent prompt with tool and workflow instructions", () => {
    const ctx = createCommandContext(() => {});
    const prompt = buildProjectTaskPrompt("refactor the CLI commands", ctx);

    expect(prompt).toContain("Repo path: /tmp/project");
    expect(prompt).toContain("grep_code");
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("apply_patch");
    expect(prompt).toContain("run_tests");
    expect(prompt).toContain("git_diff");
    expect(prompt).toContain("Required workflow:");
    expect(prompt).toContain("First action: call an MCP tool");
    expect(prompt).toContain("hosted sandbox such as /mnt/data");
    expect(prompt).toContain("MCP connector is not active in this chat.");
    expect(prompt).toContain("User task:\nrefactor the CLI commands");
  });

  it("sends wrapped prompts for /task and /work", async () => {
    const sent: string[] = [];
    const ctx = createCommandContext((content) => sent.push(content));

    await executeCommand("/task add a registry", ctx);
    await executeCommand("/work improve tests", ctx);

    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("User task:\nadd a registry");
    expect(sent[1]).toContain("User task:\nimprove tests");
  });

  it("clears the local terminal message view without sending a prompt", async () => {
    const sent: string[] = [];
    let cleared = false;
    const ctx = {
      ...createCommandContext((content) => sent.push(content)),
      clearMessages: () => {
        cleared = true;
      },
    };

    await executeCommand("/clear", ctx);

    expect(cleared).toBe(true);
    expect(sent).toEqual([]);
  });

  it("prints MCP diagnostics with connector URL and tool names", async () => {
    const sent: string[] = [];
    const ctx = createCommandContext((content) => sent.push(content));
    ctx.config.tunnelUrl = "https://bridge.example/";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    let output = "";
    try {
      await executeCommand("/mcp", ctx);
      output = log.mock.calls.map((call) => String(call[0])).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("Connector: https://bridge.example/mcp");
    expect(output).toContain("grep_code");
    expect(output).toContain("read_file");
    expect(output).toContain("git_diff");
    expect(output).toContain("No MCP tool calls observed yet");
    expect(output).toContain("Startup automatically syncs the current Connector URL");
    expect(output).toContain("Run /connector only to retry");
    expect(output).toContain("/mnt/data");
    expect(output).toContain("upload a zip");
    expect(sent).toEqual([]);
  });

  it("prints MCP diagnostics when connector tool calls were observed", async () => {
    const sent: string[] = [];
    const ctx = createCommandContext((content) => sent.push(content));
    ctx.config.tunnelUrl = "https://bridge.example/";
    ctx.statusline = {
      toolCallCount: () => 2,
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    let output = "";
    try {
      await executeCommand("/mcp", ctx);
      output = log.mock.calls.map((call) => String(call[0])).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(output).toContain("Tool calls observed this session: 2");
    expect(output).toContain("MCP tool calls observed in this bridge session.");
    expect(sent).toEqual([]);
  });

  it("opens connector setup with the normalized connector URL", async () => {
    const sent: string[] = [];
    const ctx = createCommandContext((content) => sent.push(content));
    const setupCalls: string[] = [];
    ctx.config.tunnelUrl = "https://bridge.example/";
    ctx.orchestrator.openConnectorSetup = async (input) => {
      setupCalls.push(input.connectorUrl);
      return {
        connectorUrl: input.connectorUrl,
        completed: false,
        steps: ["Opened settings"],
        warnings: ["Manual finish needed"],
      };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await executeCommand("/connector", ctx);
    } finally {
      log.mockRestore();
    }

    expect(setupCalls).toEqual(["https://bridge.example/mcp"]);
    expect(sent).toEqual([]);
  });

  it("does not run browser setup when no tunnel URL exists", async () => {
    const sent: string[] = [];
    const ctx = createCommandContext((content) => sent.push(content));
    let setupCalled = false;
    ctx.orchestrator.openConnectorSetup = async (input) => {
      setupCalled = true;
      return { connectorUrl: input.connectorUrl, completed: true, steps: [], warnings: [] };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await executeCommand("/connector", ctx);
    } finally {
      log.mockRestore();
    }

    expect(setupCalled).toBe(false);
    expect(sent).toEqual([]);
  });

  it("detects natural project requests for MCP-first wrapping", () => {
    expect(
      shouldAutoWrapProjectPrompt("hi there can u check the structure of my project local"),
    ).toBe(true);
    expect(shouldAutoWrapProjectPrompt("refactor @src/terminal/tui/App.tsx")).toBe(true);
    expect(shouldAutoWrapProjectPrompt("hi there how are you")).toBe(false);
  });

  it("keeps terminal message roles readable and visually distinct", () => {
    const userTheme = getMessageRoleTheme("user");
    const assistantTheme = getMessageRoleTheme("assistant");

    expect(userTheme.backgroundColor).not.toBe(assistantTheme.backgroundColor);
    expect(assistantTheme.color).toBe("white");
    expect(assistantTheme.color).not.toBe("black");
  });
});
