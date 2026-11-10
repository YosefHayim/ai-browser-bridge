import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadAllAttachmentsTool,
  downloadAttachmentTool,
  listAttachmentsTool,
} from "./mcp-server.ts";

const { downloadAttachmentMock, downloadAllMock } = vi.hoisted(() => ({
  downloadAttachmentMock: vi.fn(),
  downloadAllMock: vi.fn(),
}));

vi.mock("@/providers/chatgpt/chatgpt-page.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/chatgpt/chatgpt-page.ts")>();
  return {
    ...actual,
    downloadAttachment: downloadAttachmentMock,
    downloadAll: downloadAllMock,
  };
});

const originalCwd = process.cwd();
let scratchDirectory: string;

beforeEach(async () => {
  scratchDirectory = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "bridge-mcp-attachments-")),
  );
  process.chdir(scratchDirectory);
  downloadAttachmentMock.mockReset();
  downloadAllMock.mockReset();
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(scratchDirectory, { recursive: true, force: true });
});

describe("MCP attachment tools", () => {
  it("lists attachments for the active browser conversation", async () => {
    await writeManifest("conv-1");

    const toolReport = await listAttachmentsTool.handler({
      _page: createConversationPage("conv-1"),
      _repoRoot: scratchDirectory,
    });

    expect(toolReport.ok).toBe(true);
    expect(JSON.parse(toolReport.output)).toMatchObject([
      { id: "file-1", kind: "file", filename: "report.csv", messageIndex: 2 },
    ]);
  });

  it("downloads a single attachment", async () => {
    downloadAttachmentMock.mockResolvedValue({ path: "/tmp/report.csv", bytes: 42 });

    const toolReport = await downloadAttachmentTool.handler({
      _page: createConversationPage("conv-1"),
      _repoRoot: "/repo",
      id: "file-1",
    });

    expect(downloadAttachmentMock).toHaveBeenCalledWith(expect.any(Object), "conv-1", "file-1", {
      repoRoot: "/repo",
      manifestRoot: "/repo/.bridge/downloads",
    });
    expect(JSON.parse(toolReport.output)).toEqual({ path: "/tmp/report.csv", bytes: 42 });
  });

  it("downloads all selected attachments", async () => {
    downloadAllMock.mockResolvedValue([
      { id: "file-1", path: "/tmp/report.csv", bytes: 42 },
      { id: "image-1", path: "", bytes: 0, error: "missing" },
    ]);

    const toolReport = await downloadAllAttachmentsTool.handler({
      _page: createConversationPage("conv-1"),
      _repoRoot: "/repo",
      outDir: "/tmp/out",
      ids: ["file-1", "image-1"],
    });

    expect(downloadAllMock).toHaveBeenCalledWith(expect.any(Object), "conv-1", {
      repoRoot: "/repo",
      manifestRoot: "/repo/.bridge/downloads",
      outDir: "/tmp/out",
      ids: ["file-1", "image-1"],
    });
    expect(JSON.parse(toolReport.output)).toEqual([
      { id: "file-1", path: "/tmp/report.csv", bytes: 42 },
      { id: "image-1", path: "", bytes: 0, error: "missing" },
    ]);
  });
});

const writeManifest = async (conversationId: string): Promise<void> => {
  const directory = path.join(scratchDirectory, ".bridge", "downloads", conversationId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "manifest.json"),
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
      ],
    }),
    "utf8",
  );
};

const createConversationPage = (conversationId: string): Page => {
  return {
    url: () => `https://chatgpt.com/c/${conversationId}`,
  } as unknown as Page;
};
