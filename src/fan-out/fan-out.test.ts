import { describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@/browser/browser-session.ts";
import { runOneTaskOnTab } from "@/fan-out/fan-out.ts";

describe("runOneTaskOnTab", () => {
  it("rejects a Claude Design task before opening a tab that would cancel its turn", async () => {
    const openTab = vi.fn();
    const browser = { openTab } as unknown as BrowserSession;

    await expect(
      runOneTaskOnTab({
        browser,
        bridgeSettings: { repoPath: "/repo", mcpPort: 8765, contextLimit: 128_000 },
        task: { prompt: "make a deck", provider: "design" },
      }),
    ).rejects.toThrow(/bridge design send/);
    expect(openTab).not.toHaveBeenCalled();
  });
});
