import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Attachment, AttachmentManifest } from "@/features/conversations/attachments.ts";
import {
  AttachmentDownloadError,
  downloadAll,
  downloadAttachment,
  saveManifest,
} from "./chatgptAttachments.ts";

type HttpResponse =
  | Buffer
  | {
      body: Buffer;
      headers?: Record<string, string>;
    };

const originalCwd = process.cwd();

let tempDir: string;

beforeEach(async () => {
  tempDir = await realpath(await mkdtemp(path.join(os.tmpdir(), "bridge-attachment-downloader-")));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("attachment downloader", () => {
  it("downloads an https attachment through the browser request context", async () => {
    await writeManifest("conv-http", [
      {
        id: "file-1",
        role: "assistant",
        kind: "file",
        url: "https://example.test/reports/output.csv",
        filename: "output.csv",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const page = pageWithHttp({
      "https://example.test/reports/output.csv": Buffer.from("a,b\n1,2\n"),
    });
    const downloadedAttachment = await downloadAttachment(
      page.page,
      "conv-http",
      "file-1",
      downloadOptions(),
    );

    expect(downloadedAttachment.bytes).toBe(8);
    expect(path.relative(tempDir, downloadedAttachment.path)).toBe(
      path.join(".bridge", "downloads", "conv-http", "output.csv"),
    );
    await expect(readFile(downloadedAttachment.path, "utf8")).resolves.toBe("a,b\n1,2\n");
  });

  it("sanitizes filenames before writing", async () => {
    await writeManifest("conv-sanitize", [
      {
        id: "image-1",
        role: "assistant",
        kind: "image",
        url: "data:image/png;base64,cG5n",
        filename: "../\u0000..chart/image.png",
        mime: "image/png",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const downloadedAttachment = await downloadAttachment(
      emptyPage(),
      "conv-sanitize",
      "image-1",
      downloadOptions(),
    );

    expect(path.basename(downloadedAttachment.path)).toBe("chartimage.png");
    expect(path.dirname(downloadedAttachment.path)).toBe(
      path.join(tempDir, ".bridge", "downloads", "conv-sanitize"),
    );
  });

  it("adds an extension from the response mime type when a filename has none", async () => {
    await writeManifest("conv-mime-extension", [
      {
        id: "user-image-1",
        role: "user",
        kind: "image",
        url: "https://example.test/generated/image",
        filename: "Uploaded image",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const downloadedAttachment = await downloadAttachment(
      pageWithHttp({
        "https://example.test/generated/image": {
          body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          headers: { "content-type": "image/png" },
        },
      }).page,
      "conv-mime-extension",
      "user-image-1",
      downloadOptions(),
    );

    expect(path.basename(downloadedAttachment.path)).toBe("Uploaded image.png");
  });

  it("disambiguates repeated attachment filenames for different ids", async () => {
    await writeManifest("conv-collision", [
      {
        id: "user-image-1",
        role: "user",
        kind: "image",
        url: "data:image/png;base64,Zmlyc3Q=",
        filename: "Uploaded image",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "user-image-2",
        role: "user",
        kind: "image",
        url: "data:image/png;base64,c2Vjb25k",
        filename: "Uploaded image",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:01.000Z",
      },
    ]);

    const downloadedAttachments = await downloadAll(
      emptyPage(),
      "conv-collision",
      downloadOptions(),
    );
    const outputDir = path.join(tempDir, ".bridge", "downloads", "conv-collision");
    const firstPath = path.join(outputDir, "Uploaded image.png");
    const secondPath = path.join(outputDir, "Uploaded image-user-image-2.png");

    expect(
      downloadedAttachments.map((downloadedAttachment) => path.basename(downloadedAttachment.path)),
    ).toEqual(["Uploaded image.png", "Uploaded image-user-image-2.png"]);
    await expect(readFile(firstPath, "utf8")).resolves.toBe("first");
    await expect(readFile(secondPath, "utf8")).resolves.toBe("second");
  });

  it("keeps traversal attempts inside the output directory", async () => {
    const outDir = path.join(tempDir, "safe-output");
    await writeManifest("conv-traversal", [
      {
        id: "file-1",
        role: "assistant",
        kind: "file",
        url: "data:text/plain;base64,c2FmZQ==",
        filename: "../../outside.txt",
        mime: "text/plain",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const downloadedAttachment = await downloadAttachment(emptyPage(), "conv-traversal", "file-1", {
      ...downloadOptions(),
      outDir,
    });

    expect(downloadedAttachment.path.startsWith(`${outDir}${path.sep}`)).toBe(true);
    await expect(readFile(downloadedAttachment.path, "utf8")).resolves.toBe("safe");
    await expect(stat(path.join(tempDir, "outside.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("downloads blob attachments by evaluating fetch in the page", async () => {
    await writeManifest("conv-blob", [
      {
        id: "image-1",
        role: "assistant",
        kind: "image",
        url: "blob:https://chatgpt.test/image-1",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const downloadedAttachment = await downloadAttachment(
      pageWithBlob(new Uint8Array([1, 2, 3])),
      "conv-blob",
      "image-1",
      downloadOptions(),
    );

    expect(downloadedAttachment.bytes).toBe(3);
    expect(path.basename(downloadedAttachment.path)).toBe("image-1");
    await expect(readFile(downloadedAttachment.path)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("throws a typed error for a missing id", async () => {
    await writeManifest("conv-missing", []);

    await expect(
      downloadAttachment(emptyPage(), "conv-missing", "file-404", downloadOptions()),
    ).rejects.toMatchObject({
      name: "AttachmentDownloadError",
      id: "file-404",
      message: "Attachment not found in manifest: file-404",
    });
  });

  it("continues downloadAll after per-item failures", async () => {
    await writeManifest("conv-all", [
      {
        id: "file-1",
        role: "assistant",
        kind: "file",
        url: "https://example.test/good.txt",
        filename: "good.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "file-2",
        role: "assistant",
        kind: "file",
        url: "https://example.test/missing.txt",
        filename: "missing.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const downloadedAttachments = await downloadAll(
      pageWithHttp({
        "https://example.test/good.txt": Buffer.from("ok"),
      }).page,
      "conv-all",
      downloadOptions(),
    );

    expect(downloadedAttachments).toHaveLength(2);
    expect(downloadedAttachments[0]).toMatchObject({ id: "file-1", bytes: 2 });
    expect(downloadedAttachments[1]?.id).toBe("file-2");
    expect(downloadedAttachments[1]?.error).toContain("HTTP 404");
  });

  it("throws from downloadAll only when every selected attachment fails", async () => {
    await writeManifest("conv-all-fail", [
      {
        id: "file-1",
        role: "assistant",
        kind: "file",
        url: "https://example.test/fail.txt",
        filename: "fail.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    await expect(
      downloadAll(pageWithHttp({}).page, "conv-all-fail", downloadOptions()),
    ).rejects.toBeInstanceOf(AttachmentDownloadError);
  });

  it("skips re-downloading when an existing file has the same byte length", async () => {
    await writeManifest("conv-idempotent", [
      {
        id: "file-1",
        role: "assistant",
        kind: "file",
        url: "https://example.test/same.txt",
        filename: "same.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);
    const targetDir = path.join(tempDir, ".bridge", "downloads", "conv-idempotent");
    const target = path.join(targetDir, "same.txt");
    await mkdir(targetDir, { recursive: true });
    await writeFile(target, "same");
    const page = pageWithHttp({
      "https://example.test/same.txt": Buffer.from("same"),
    });

    const downloadedAttachment = await downloadAttachment(
      page.page,
      "conv-idempotent",
      "file-1",
      downloadOptions(),
    );

    expect(downloadedAttachment).toEqual({ path: target, bytes: 4 });
    expect(page.requests()).toEqual({ gets: 1, bodies: 0 });
    await expect(readFile(target, "utf8")).resolves.toBe("same");
  });
});

const writeManifest = async (conversationId: string, attachments: Attachment[]): Promise<void> => {
  const manifest: AttachmentManifest = {
    conversationId,
    attachments,
    counters: { assistant: { image: 0, file: 0, pdf: 0 }, user: { image: 0, file: 0, pdf: 0 } },
  };
  await saveManifest(manifest, { manifestRoot: downloadOptions().manifestRoot });
};

const downloadOptions = (): { repoRoot: string; manifestRoot: string } => ({
  repoRoot: tempDir,
  manifestRoot: path.join(tempDir, "manifests"),
});

const pageWithHttp = (
  responses: Record<string, HttpResponse>,
): {
  page: Page;
  requests: () => { gets: number; bodies: number };
} => {
  let getCount = 0;
  let bodyCount = 0;
  const page = {
    context: () => ({
      request: {
        get: async (url: string) => {
          getCount += 1;
          const downloadResponse = responses[url];
          const downloadBytes = Buffer.isBuffer(downloadResponse)
            ? downloadResponse
            : downloadResponse?.body;
          const headers = Buffer.isBuffer(downloadResponse) ? undefined : downloadResponse?.headers;
          return {
            ok: () => downloadBytes !== undefined,
            status: () => (downloadBytes === undefined ? 404 : 200),
            headers: () =>
              downloadBytes === undefined
                ? {}
                : { "content-length": String(downloadBytes.byteLength), ...headers },
            body: async () => {
              bodyCount += 1;
              if (downloadBytes === undefined) return Buffer.alloc(0);
              return downloadBytes;
            },
          };
        },
      },
    }),
  } as unknown as Page;
  return { page, requests: () => ({ gets: getCount, bodies: bodyCount }) };
};

const pageWithBlob = (bytes: Uint8Array): Page => {
  return {
    evaluate: async <Result>(): Promise<Result> => bytes as Result,
  } as unknown as Page;
};

const emptyPage = (): Page => {
  return {} as Page;
};
