import { describe, expect, it, vi } from "vitest";
import type { CommandSession } from "@/domain/command-types.ts";
import { executeCommand } from "@/terminal/slash-commands/slash-command-registry.ts";
import { createProjectTaskPrompt } from "./project-task-prompt.ts";
import { canAutoWrapProjectPrompt, readMessageRoleTheme } from "./tui/shell/role-theme-config.ts";

const createTaskCommandScope = (onSend: (message: string) => void): CommandSession => {
  return {
    config: {
      repoPath: "/tmp/project",
      mcpPort: 8765,
      contextLimit: 128_000,
      model: "GPT-5.3 Instant",
    },
    messages: [],
    sendMessage: async (message: string) => {
      onSend(message);
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
      openNewConversation: async () => {},
      model: "GPT-5.3 Instant",
      page: null,
      detectModel: async () => "GPT-5.3 Instant",
      listModels: async () => [],
      switchModel: async () => "GPT-5.3 Instant",
      rewindLastPrompt: async () => {},
      stopReply: async () => false,
      openConnectorSetup: undefined,
    },
  };
};

describe("task command", () => {
  it("builds a project-agent prompt with tool and workflow instructions", () => {
    const commandSetup = createTaskCommandScope(() => {});
    const prompt = createProjectTaskPrompt("refactor the CLI commands", commandSetup);

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
    const commandSetup = createTaskCommandScope((sentPrompt) => sent.push(sentPrompt));

    await executeCommand("/task add a registry", commandSetup);
    await executeCommand("/work improve tests", commandSetup);

    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("User task:\nadd a registry");
    expect(sent[1]).toContain("User task:\nimprove tests");
  });

  it("clears the local terminal message view without sending a prompt", async () => {
    const sent: string[] = [];
    let cleared = false;
    const commandSetup = {
      ...createTaskCommandScope((sentPrompt) => sent.push(sentPrompt)),
      clearMessages: () => {
        cleared = true;
      },
    };

    await executeCommand("/clear", commandSetup);

    expect(cleared).toBe(true);
    expect(sent).toEqual([]);
  });

  it("prints MCP diagnostics with connector URL and tool names", async () => {
    const sent: string[] = [];
    const commandSetup = createTaskCommandScope((sentPrompt) => sent.push(sentPrompt));
    commandSetup.config.tunnelUrl = "https://bridge.example/";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    let printout = "";
    try {
      await executeCommand("/mcp", commandSetup);
      printout = log.mock.calls.map((call) => String(call[0])).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(printout).toContain("Connector: https://bridge.example/mcp");
    expect(printout).toContain("grep_code");
    expect(printout).toContain("read_file");
    expect(printout).toContain("git_diff");
    expect(printout).toContain("No MCP tool calls observed yet");
    expect(printout).toContain("Startup automatically syncs the current Connector URL");
    expect(printout).toContain("Run /connector only to retry");
    expect(printout).toContain("/mnt/data");
    expect(printout).toContain("upload a zip");
    expect(sent).toEqual([]);
  });

  it("prints MCP diagnostics when connector tool calls were observed", async () => {
    const sent: string[] = [];
    const commandSetup = createTaskCommandScope((sentPrompt) => sent.push(sentPrompt));
    commandSetup.config.tunnelUrl = "https://bridge.example/";
    commandSetup.statusline = {
      toolCallCount: () => 2,
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    let printout = "";
    try {
      await executeCommand("/mcp", commandSetup);
      printout = log.mock.calls.map((call) => String(call[0])).join("\n");
    } finally {
      log.mockRestore();
    }

    expect(printout).toContain("Tool calls observed this session: 2");
    expect(printout).toContain("MCP tool calls observed in this bridge session.");
    expect(sent).toEqual([]);
  });

  it("opens connector setup with the normalized connector URL", async () => {
    const sent: string[] = [];
    const commandSetup = createTaskCommandScope((sentPrompt) => sent.push(sentPrompt));
    const setupCalls: string[] = [];
    commandSetup.config.tunnelUrl = "https://bridge.example/";
    commandSetup.orchestrator.openConnectorSetup = async (details) => {
      setupCalls.push(details.connectorUrl);
      return {
        connectorUrl: details.connectorUrl,
        completed: false,
        steps: ["Opened settings"],
        warnings: ["Manual finish needed"],
      };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await executeCommand("/connector", commandSetup);
    } finally {
      log.mockRestore();
    }

    expect(setupCalls).toEqual(["https://bridge.example/mcp"]);
    expect(sent).toEqual([]);
  });

  it("does not run browser setup when no tunnel URL exists", async () => {
    const sent: string[] = [];
    const commandSetup = createTaskCommandScope((sentPrompt) => sent.push(sentPrompt));
    let setupCalled = false;
    commandSetup.orchestrator.openConnectorSetup = async (details) => {
      setupCalled = true;
      return { connectorUrl: details.connectorUrl, completed: true, steps: [], warnings: [] };
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await executeCommand("/connector", commandSetup);
    } finally {
      log.mockRestore();
    }

    expect(setupCalled).toBe(false);
    expect(sent).toEqual([]);
  });

  it("detects natural project requests for MCP-first wrapping", () => {
    expect(canAutoWrapProjectPrompt("hi there can u check the structure of my project local")).toBe(
      true,
    );
    expect(canAutoWrapProjectPrompt("refactor @src/terminal/tui/App.tsx")).toBe(true);
    expect(canAutoWrapProjectPrompt("hi there how are you")).toBe(false);
  });

  it("keeps terminal message roles readable and visually distinct", () => {
    const userTheme = readMessageRoleTheme("user");
    const assistantTheme = readMessageRoleTheme("assistant");

    expect(userTheme.backgroundColor).not.toBe(assistantTheme.backgroundColor);
    expect(assistantTheme.color).toBe("white");
    expect(assistantTheme.color).not.toBe("black");
  });
});
