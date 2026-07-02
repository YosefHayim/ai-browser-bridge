import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Attachment, AttachmentManifest } from "../../../../src/features/domain/types.ts";
import { saveManifest } from "../../../../src/features/providers/chatgpt/chatgptPage.ts";
import {
  AttachmentDownloadError,
  downloadAll,
  downloadAttachment,
} from "../../../../src/features/providers/chatgpt/chatgptPage.ts";

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
    const result = await downloadAttachment(page.page, "conv-http", "file-1");

    expect(result.bytes).toBe(8);
    expect(path.relative(tempDir, result.path)).toBe(
      path.join("downloads", "conv-http", "output.csv"),
    );
    await expect(readFile(result.path, "utf8")).resolves.toBe("a,b\n1,2\n");
  });

  it("sanitizes filenames before writing", async () => {
    await writeManifest("conv-sanitize", [
      {
        id: "image-1",
        kind: "image",
        url: "data:image/png;base64,cG5n",
        filename: "../\u0000..chart/image.png",
        mime: "image/png",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const result = await downloadAttachment(emptyPage(), "conv-sanitize", "image-1");

    expect(path.basename(result.path)).toBe("chartimage.png");
    expect(path.dirname(result.path)).toBe(path.join(tempDir, "downloads", "conv-sanitize"));
  });

  it("adds an extension from the response mime type when a filename has none", async () => {
    await writeManifest("conv-mime-extension", [
      {
        id: "user-image-1",
        kind: "image",
        url: "https://example.test/generated/image",
        filename: "Uploaded image",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const result = await downloadAttachment(
      pageWithHttp({
        "https://example.test/generated/image": {
          body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          headers: { "content-type": "image/png" },
        },
      }).page,
      "conv-mime-extension",
      "user-image-1",
    );

    expect(path.basename(result.path)).toBe("Uploaded image.png");
  });

  it("disambiguates repeated attachment filenames for different ids", async () => {
    await writeManifest("conv-collision", [
      {
        id: "user-image-1",
        kind: "image",
        url: "data:image/png;base64,Zmlyc3Q=",
        filename: "Uploaded image",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "user-image-2",
        kind: "image",
        url: "data:image/png;base64,c2Vjb25k",
        filename: "Uploaded image",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:01.000Z",
      },
    ]);

    const results = await downloadAll(emptyPage(), "conv-collision");
    const outputDir = path.join(tempDir, "downloads", "conv-collision");
    const firstPath = path.join(outputDir, "Uploaded image.png");
    const secondPath = path.join(outputDir, "Uploaded image-user-image-2.png");

    expect(results.map((result) => path.basename(result.path))).toEqual([
      "Uploaded image.png",
      "Uploaded image-user-image-2.png",
    ]);
    await expect(readFile(firstPath, "utf8")).resolves.toBe("first");
    await expect(readFile(secondPath, "utf8")).resolves.toBe("second");
  });

  it("keeps traversal attempts inside the output directory", async () => {
    const outDir = path.join(tempDir, "safe-output");
    await writeManifest("conv-traversal", [
      {
        id: "file-1",
        kind: "file",
        url: "data:text/plain;base64,c2FmZQ==",
        filename: "../../outside.txt",
        mime: "text/plain",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const result = await downloadAttachment(emptyPage(), "conv-traversal", "file-1", { outDir });

    expect(result.path.startsWith(`${outDir}${path.sep}`)).toBe(true);
    await expect(readFile(result.path, "utf8")).resolves.toBe("safe");
    await expect(stat(path.join(tempDir, "outside.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("downloads blob attachments by evaluating fetch in the page", async () => {
    await writeManifest("conv-blob", [
      {
        id: "image-1",
        kind: "image",
        url: "blob:https://chatgpt.test/image-1",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const result = await downloadAttachment(
      pageWithBlob(new Uint8Array([1, 2, 3])),
      "conv-blob",
      "image-1",
    );

    expect(result.bytes).toBe(3);
    expect(path.basename(result.path)).toBe("image-1");
    await expect(readFile(result.path)).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("throws a typed error for a missing id", async () => {
    await writeManifest("conv-missing", []);

    await expect(downloadAttachment(emptyPage(), "conv-missing", "file-404")).rejects.toMatchObject(
      {
        name: "AttachmentDownloadError",
        id: "file-404",
        message: "Attachment not found in manifest: file-404",
      },
    );
  });

  it("continues downloadAll after per-item failures", async () => {
    await writeManifest("conv-all", [
      {
        id: "file-1",
        kind: "file",
        url: "https://example.test/good.txt",
        filename: "good.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "file-2",
        kind: "file",
        url: "https://example.test/missing.txt",
        filename: "missing.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const results = await downloadAll(
      pageWithHttp({
        "https://example.test/good.txt": Buffer.from("ok"),
      }).page,
      "conv-all",
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: "file-1", bytes: 2 });
    expect(results[1]?.id).toBe("file-2");
    expect(results[1]?.error).toContain("HTTP 404");
  });

  it("throws from downloadAll only when every selected attachment fails", async () => {
    await writeManifest("conv-all-fail", [
      {
        id: "file-1",
        kind: "file",
        url: "https://example.test/fail.txt",
        filename: "fail.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);

    await expect(downloadAll(pageWithHttp({}).page, "conv-all-fail")).rejects.toBeInstanceOf(
      AttachmentDownloadError,
    );
  });

  it("skips re-downloading when an existing file has the same byte length", async () => {
    await writeManifest("conv-idempotent", [
      {
        id: "file-1",
        kind: "file",
        url: "https://example.test/same.txt",
        filename: "same.txt",
        messageIndex: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);
    const targetDir = path.join(tempDir, "downloads", "conv-idempotent");
    const target = path.join(targetDir, "same.txt");
    await mkdir(targetDir, { recursive: true });
    await writeFile(target, "same");
    const page = pageWithHttp({
      "https://example.test/same.txt": Buffer.from("same"),
    });

    const result = await downloadAttachment(page.page, "conv-idempotent", "file-1");

    expect(result).toEqual({ path: target, bytes: 4 });
    expect(page.requests()).toEqual({ gets: 1, bodies: 0 });
    await expect(readFile(target, "utf8")).resolves.toBe("same");
  });
});

async function writeManifest(conversationId: string, attachments: Attachment[]): Promise<void> {
  const manifest: AttachmentManifest = {
    conversationId,
    attachments,
    counters: { image: 0, file: 0, pdf: 0 },
  };
  await saveManifest(manifest);
}

type HttpResponse =
  | Buffer
  | {
      body: Buffer;
      headers?: Record<string, string>;
    };

function pageWithHttp(responses: Record<string, HttpResponse>): {
  page: Page;
  requests: () => { gets: number; bodies: number };
} {
  let getCount = 0;
  let bodyCount = 0;
  const page = {
    context: () => ({
      request: {
        get: async (url: string) => {
          getCount += 1;
          const response = responses[url];
          const body = Buffer.isBuffer(response) ? response : response?.body;
          const headers = Buffer.isBuffer(response) ? undefined : response?.headers;
          return {
            ok: () => body !== undefined,
            status: () => (body === undefined ? 404 : 200),
            headers: () =>
              body === undefined ? {} : { "content-length": String(body.byteLength), ...headers },
            body: async () => {
              bodyCount += 1;
              return body ?? Buffer.alloc(0);
            },
          };
        },
      },
    }),
  } as unknown as Page;
  return { page, requests: () => ({ gets: getCount, bodies: bodyCount }) };
}

function pageWithBlob(bytes: Uint8Array): Page {
  return {
    evaluate: async <Result>(): Promise<Result> => bytes as Result,
  } as unknown as Page;
}

function emptyPage(): Page {
  return {} as Page;
}
