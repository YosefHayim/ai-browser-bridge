import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendSessionEvent,
  createSession,
  exportSession,
  getLatestSession,
  listSessions,
  loadSession,
  updateSession,
} from "../../../src/features/store/sessionStore.ts";

async function makeStoreDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "bridge-session-store-"));
}

describe("session store", () => {
  it("creates and loads session metadata from an explicit base directory", async () => {
    const baseDir = await makeStoreDir();

    await createSession(
      {
        id: "session-1",
        repoPath: "/repo",
        model: "GPT-5.2",
        contextLimit: 128_000,
        tunnelUrl: "https://bridge.example",
        startedAt: "2026-04-28T10:00:00.000Z",
      },
      { baseDir },
    );

    const loaded = await loadSession("session-1", { baseDir });

    expect(loaded.metadata).toEqual({
      id: "session-1",
      repoPath: "/repo",
      model: "GPT-5.2",
      contextLimit: 128_000,
      tunnelUrl: "https://bridge.example",
      startedAt: "2026-04-28T10:00:00.000Z",
      updatedAt: "2026-04-28T10:00:00.000Z",
    });
    expect(loaded.events).toEqual([]);
  });

  it("appends transcript and action events as JSONL and exports copyable formats", async () => {
    const baseDir = await makeStoreDir();
    await createSession(
      {
        id: "session-2",
        repoPath: "/repo",
        model: "GPT-5.2",
        contextLimit: 128_000,
        startedAt: "2026-04-28T10:00:00.000Z",
      },
      { baseDir },
    );

    await appendSessionEvent(
      "session-2",
      {
        id: "event-1",
        type: "message",
        role: "user",
        content: "hello bridge",
        createdAt: "2026-04-28T10:01:00.000Z",
      },
      { baseDir },
    );
    await appendSessionEvent(
      "session-2",
      {
        id: "event-2",
        type: "action",
        name: "grep",
        status: "completed",
        content: "found 2 matches",
        data: { pattern: "Session" },
        createdAt: "2026-04-28T10:02:00.000Z",
      },
      { baseDir },
    );

    const loaded = await loadSession("session-2", { baseDir });
    const rawJsonl = await readFile(join(baseDir, "session-2", "events.jsonl"), "utf-8");
    const exported = await exportSession("session-2", { baseDir });

    expect(loaded.metadata.updatedAt).toBe("2026-04-28T10:02:00.000Z");
    expect(loaded.events).toHaveLength(2);
    expect(rawJsonl.trim().split("\n")).toHaveLength(2);
    expect(exported.transcript).toContain("[2026-04-28T10:01:00.000Z] user: hello bridge");
    expect(exported.transcript).toContain(
      "[2026-04-28T10:02:00.000Z] action grep completed: found 2 matches",
    );
    expect(JSON.parse(exported.json)).toEqual(loaded);
    expect(exported.jsonl).toBe(rawJsonl);
  });

  it("updates metadata and returns sessions sorted by latest activity", async () => {
    const baseDir = await makeStoreDir();
    await createSession(
      {
        id: "older",
        repoPath: "/repo-a",
        model: null,
        contextLimit: 64_000,
        startedAt: "2026-04-28T09:00:00.000Z",
      },
      { baseDir },
    );
    await createSession(
      {
        id: "newer",
        repoPath: "/repo-b",
        model: "GPT-5.2",
        contextLimit: 128_000,
        startedAt: "2026-04-28T10:00:00.000Z",
      },
      { baseDir },
    );

    await updateSession(
      "older",
      {
        model: "GPT-5.5 Pro",
        tunnelUrl: "https://latest.example",
        updatedAt: "2026-04-28T11:00:00.000Z",
      },
      { baseDir },
    );

    const sessions = await listSessions({ baseDir });
    const latest = await getLatestSession({ baseDir });

    expect(sessions.map((session) => session.id)).toEqual(["older", "newer"]);
    expect(latest?.metadata.id).toBe("older");
    expect(latest?.metadata.model).toBe("GPT-5.5 Pro");
    expect(latest?.metadata.tunnelUrl).toBe("https://latest.example");
  });
});
