import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadAllAttachmentsTool,
  downloadAttachmentTool,
  listAttachmentsTool,
} from "../src/mcp/tools/attachments.ts";

const { downloadAttachmentMock, downloadAllMock } = vi.hoisted(() => ({
  downloadAttachmentMock: vi.fn(),
  downloadAllMock: vi.fn(),
}));

vi.mock("../src/browser/attachment-downloader.ts", () => ({
  downloadAttachment: downloadAttachmentMock,
  downloadAll: downloadAllMock,
}), { virtual: true });

const originalCwd = process.cwd();
let tempDir: string;

beforeEach(async () => {
  tempDir = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "bridge-mcp-attachments-")));
  process.chdir(tempDir);
  downloadAttachmentMock.mockReset();
  downloadAllMock.mockReset();
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("MCP attachment tools", () => {
  it("lists attachments for the active browser conversation", async () => {
    await writeManifest("conv-1");

    const result = await listAttachmentsTool.handler({ _page: page("conv-1") });

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output)).toMatchObject([
      { id: "file-1", kind: "file", filename: "report.csv", messageIndex: 2 },
    ]);
  });

  it("downloads a single attachment", async () => {
    downloadAttachmentMock.mockResolvedValue({ path: "/tmp/report.csv", bytes: 42 });

    const result = await downloadAttachmentTool.handler({ _page: page("conv-1"), id: "file-1" });

    expect(downloadAttachmentMock).toHaveBeenCalledWith(expect.any(Object), "conv-1", "file-1", undefined);
    expect(JSON.parse(result.output)).toEqual({ path: "/tmp/report.csv", bytes: 42 });
  });

  it("downloads all selected attachments", async () => {
    downloadAllMock.mockResolvedValue([
      { id: "file-1", path: "/tmp/report.csv", bytes: 42 },
      { id: "image-1", path: "", bytes: 0, error: "missing" },
    ]);

    const result = await downloadAllAttachmentsTool.handler({
      _page: page("conv-1"),
      outDir: "/tmp/out",
      ids: ["file-1", "image-1"],
    });

    expect(downloadAllMock).toHaveBeenCalledWith(expect.any(Object), "conv-1", {
      outDir: "/tmp/out",
      ids: ["file-1", "image-1"],
    });
    expect(JSON.parse(result.output)).toEqual([
      { id: "file-1", path: "/tmp/report.csv", bytes: 42 },
      { id: "image-1", path: "", bytes: 0, error: "missing" },
    ]);
  });
});

async function writeManifest(conversationId: string): Promise<void> {
  const dir = path.join(tempDir, "downloads", conversationId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({
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
  }), "utf8");
}

function page(conversationId: string): Page {
  return {
    url: () => `https://chatgpt.com/c/${conversationId}`,
  } as unknown as Page;
}
