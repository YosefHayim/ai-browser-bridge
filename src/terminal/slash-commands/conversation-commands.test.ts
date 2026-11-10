import { describe, expect, it } from "vitest";
import type { SessionMetadata } from "@/store/session-store.ts";
import { createSessionSummary } from "./conversation-commands.ts";

describe("createSessionSummary", () => {
  const base: SessionMetadata = {
    id: "s1",
    repoPath: "/repo",
    model: "GPT-5.2",
    contextLimit: 128_000,
    tunnelUrl: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  it("marks the active session as current", () => {
    expect(createSessionSummary(base, "s1")).toContain("Local session current: s1");
  });

  it("marks other sessions as loaded and renders a missing tunnel as none", () => {
    const summary = createSessionSummary(base, "other");
    expect(summary).toContain("Local session loaded: s1");
    expect(summary).toContain("Tunnel: none");
  });
});
