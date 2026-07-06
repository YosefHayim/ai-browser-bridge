import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandContext } from "@/features/domain/types.ts";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCommand } from "./cliRunner.ts";

const { downloadAttachmentMock, downloadAllMock } = vi.hoisted(() => ({
  downloadAttachmentMock: vi.fn(),
  downloadAllMock: vi.fn(),
}));

vi.mock("@/features/providers/chatgpt/chatgptPage.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/providers/chatgpt/chatgptPage.ts")>();
  return {
    ...actual,
    downloadAttachment: downloadAttachmentMock,
    downloadAll: downloadAllMock,
  };
});

const originalCwd = process.cwd();
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdirTemp();
  process.chdir(tempDir);
  downloadAttachmentMock.mockReset();
  downloadAllMock.mockReset();
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("/files command", () => {
  it("prints an attachment table for the active conversation", async () => {
    await writeManifest("conv-1");
    const logs = captureConsole("log");

    await executeCommand("/files", commandContext("conv-1"));

    expect(logs.lines.join("\n")).toContain("id       role       kind   filename    message");
    expect(logs.lines.join("\n")).toContain("file-1   assistant  file   report.csv  2");
    expect(logs.lines.join("\n")).toContain("image-1  assistant  image  chart.png   3");
    logs.restore();
  });

  it("prints the empty manifest message", async () => {
    const logs = captureConsole("log");

    await executeCommand("/files", commandContext("conv-empty"));

    expect(logs.lines).toEqual(["No attachments captured in this conversation yet."]);
    logs.restore();
  });

  it("downloads a single attachment by id", async () => {
    await writeManifest("conv-1");
    downloadAttachmentMock.mockResolvedValue({ path: "/tmp/report.csv", bytes: 42 });
    const logs = captureConsole("log");

    await executeCommand("/files get file-1", commandContext("conv-1"));

    expect(downloadAttachmentMock).toHaveBeenCalledWith(expect.any(Object), "conv-1", "file-1", {
      repoRoot: tempDir,
    });
    expect(logs.lines).toEqual(["/tmp/report.csv"]);
    logs.restore();
  });

  it("prints a red error for a bad id without downloading", async () => {
    await writeManifest("conv-1");
    const errors = captureConsole("error");

    await executeCommand("/files get missing", commandContext("conv-1"));

    expect(downloadAttachmentMock).not.toHaveBeenCalled();
    expect(errors.lines[0]).toContain('No attachment with id "missing".');
    errors.restore();
  });

  it("downloads all attachments with an output directory", async () => {
    await writeManifest("conv-1");
    downloadAllMock.mockResolvedValue([
      { id: "file-1", path: "/tmp/out/report.csv", bytes: 42 },
      { id: "image-1", path: "/tmp/out/chart.png", bytes: 99 },
    ]);
    const logs = captureConsole("log");

    await executeCommand("/files get all --out /tmp/out", commandContext("conv-1"));

    expect(downloadAllMock).toHaveBeenCalledWith(expect.any(Object), "conv-1", {
      repoRoot: tempDir,
      outDir: "/tmp/out",
    });
    expect(logs.lines[0]).toBe("Downloaded 2/2 attachments.");
    logs.restore();
  });
});

const mkdirTemp = async (): Promise<string> => {
  return await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "bridge-files-command-")),
  );
};

const writeManifest = async (conversationId: string): Promise<void> => {
  const dir = path.join(tempDir, "downloads", conversationId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      conversationId,
      attachments: [
        {
          id: "file-1",
          kind: "file",
          url: "blob:https://chatgpt.test/report",
          filename: "report.csv",
          messageIndex: 2,
          createdAt: "2026-05-01T00:00:00.000Z",
        },
        {
          id: "image-1",
          kind: "image",
          url: "https://example.test/chart.png",
          filename: "chart.png",
          messageIndex: 3,
          createdAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
};

const commandContext = (conversationId: string): CommandContext => {
  const page = {
    url: () => `https://chatgpt.com/c/${conversationId}`,
  } as unknown as Page;
  return {
    config: { repoPath: tempDir, mcpPort: 0, contextLimit: 100_000 },
    messages: [],
    sendMessage: async () => {},
    counter: {
      count: 0,
      contextLimit: 100_000,
      modelLabel: "ChatGPT",
      summary: "0 tokens",
      setModel: () => {},
    },
    orchestrator: {
      page,
      listConversations: async () => [],
      searchConversations: async () => [],
      navigateToConversation: async () => {},
      newConversation: async () => {},
      model: "ChatGPT",
      detectModel: async () => "ChatGPT",
      listModels: async () => [],
      switchModel: async () => "ChatGPT",
      rewindLastPrompt: async () => {},
      stopResponse: async () => false,
    },
  } as unknown as CommandContext;
};

const captureConsole = (method: "log" | "error"): { lines: string[]; restore: () => void } => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
};
