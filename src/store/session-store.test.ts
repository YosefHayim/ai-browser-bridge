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
} from "./session-store.ts";

const makeStoreDirectory = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "bridge-session-store-"));
};

describe("session store", () => {
  it("creates and loads session metadata from an explicit base directory", async () => {
    const baseDirectory = await makeStoreDirectory();

    await createSession(
      {
        id: "session-1",
        repoPath: "/repo",
        model: "GPT-5.2",
        contextLimit: 128_000,
        tunnelUrl: "https://bridge.example",
        startedAt: "2026-04-28T10:00:00.000Z",
      },
      { baseDir: baseDirectory },
    );

    const loaded = await loadSession("session-1", { baseDir: baseDirectory });

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
    const baseDirectory = await makeStoreDirectory();
    await createSession(
      {
        id: "session-2",
        repoPath: "/repo",
        model: "GPT-5.2",
        contextLimit: 128_000,
        startedAt: "2026-04-28T10:00:00.000Z",
      },
      { baseDir: baseDirectory },
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
      { baseDir: baseDirectory },
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
      { baseDir: baseDirectory },
    );

    const loaded = await loadSession("session-2", { baseDir: baseDirectory });
    const unparsedJsonl = await readFile(join(baseDirectory, "session-2", "events.jsonl"), "utf-8");
    const exported = await exportSession("session-2", { baseDir: baseDirectory });

    expect(loaded.metadata.updatedAt).toBe("2026-04-28T10:02:00.000Z");
    expect(loaded.events).toHaveLength(2);
    expect(unparsedJsonl.trim().split("\n")).toHaveLength(2);
    expect(exported.transcript).toContain("[2026-04-28T10:01:00.000Z] user: hello bridge");
    expect(exported.transcript).toContain(
      "[2026-04-28T10:02:00.000Z] action grep completed: found 2 matches",
    );
    expect(JSON.parse(exported.json)).toEqual(loaded);
    expect(exported.jsonl).toBe(unparsedJsonl);
  });

  it("updates metadata and returns sessions sorted by latest activity", async () => {
    const baseDirectory = await makeStoreDirectory();
    await createSession(
      {
        id: "older",
        repoPath: "/repo-a",
        model: null,
        contextLimit: 64_000,
        startedAt: "2026-04-28T09:00:00.000Z",
      },
      { baseDir: baseDirectory },
    );
    await createSession(
      {
        id: "newer",
        repoPath: "/repo-b",
        model: "GPT-5.2",
        contextLimit: 128_000,
        startedAt: "2026-04-28T10:00:00.000Z",
      },
      { baseDir: baseDirectory },
    );

    await updateSession(
      "older",
      {
        model: "GPT-5.5 Pro",
        tunnelUrl: "https://latest.example",
        updatedAt: "2026-04-28T11:00:00.000Z",
      },
      { baseDir: baseDirectory },
    );

    const sessions = await listSessions({ baseDir: baseDirectory });
    const latest = await getLatestSession({ baseDir: baseDirectory });

    expect(sessions.map((session) => session.id)).toEqual(["older", "newer"]);
    expect(latest).not.toBeNull();

    const isLatestMissing = latest == null;
    if (isLatestMissing) throw new Error("expected latest session");

    expect(latest.metadata.id).toBe("older");
    expect(latest.metadata.model).toBe("GPT-5.5 Pro");
    expect(latest.metadata.tunnelUrl).toBe("https://latest.example");
  });
});
