import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeDesignPage } from "@/testSupport/fakeDesignPage.ts";
import { listDesignFiles, putDesignFiles } from "./designFiles.ts";

describe("putDesignFiles", () => {
  it("uploads local bytes as base64 with a content type, replacing the same project path", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bridge-design-put-"));
    const localPath = join(folder, "hero.html");
    await writeFile(localPath, "<h1>Hi</h1>");
    const { page, calls } = fakeDesignPage({
      answerRpc: () => ({ files: [{ path: "pages/hero.html", version: "7" }] }),
    });

    const written = await putDesignFiles(page, {
      projectId: "p1",
      uploads: [{ localPath, path: "pages/hero.html" }],
    });

    expect(calls).toEqual([
      {
        method: "WriteFiles",
        organizationUuid: "org-1",
        body: {
          projectId: "p1",
          deduplicate: false,
          files: [
            {
              path: "pages/hero.html",
              data: Buffer.from("<h1>Hi</h1>").toString("base64"),
              mimeType: "text/html",
              encoding: "base64",
            },
          ],
        },
      },
    ]);
    expect(written).toEqual([{ path: "pages/hero.html", version: "7" }]);
  });
});

describe("listDesignFiles", () => {
  it("keeps paging until an empty page when the reply omits total", async () => {
    const pages = [[{ path: "index.html" }, { path: "styles.css" }], [{ path: "logo.svg" }], []];
    const { page, calls } = fakeDesignPage({
      answerRpc: () => ({ entries: pages[calls.length - 1] }),
    });

    const files = await listDesignFiles(page, "p1");

    expect(files.map((file) => file.path)).toEqual(["index.html", "styles.css", "logo.svg"]);
    expect(calls.map((call) => (call.body as { offset: number }).offset)).toEqual([0, 2, 3]);
  });
});
