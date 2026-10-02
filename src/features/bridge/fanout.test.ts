import { describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@/features/browser";
import { runOneTaskOnTab } from "./fanout.ts";

describe("runOneTaskOnTab", () => {
  it("rejects a Claude Design task before opening a tab that would cancel its turn", async () => {
    const openTab = vi.fn();
    const browser = { openTab } as unknown as BrowserSession;

    await expect(
      runOneTaskOnTab({
        browser,
        config: { repoPath: "/repo", mcpPort: 8765, contextLimit: 128_000 },
        task: { prompt: "make a deck", provider: "design" },
      }),
    ).rejects.toThrow(/bridge design send/);
    expect(openTab).not.toHaveBeenCalled();
  });
});
