import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chatOrganizationIntervalFrom,
  chatOrganizationIntervalLabel,
  chatOrganizationQueuePath,
  completeChatOrganizationQueueItem,
  deferChatOrganizationQueueItem,
  failChatOrganizationQueueItem,
  loadChatOrganizationTasks,
  nextChatOrganizationIntervalSeconds,
  nextChatOrganizationQueueIndex,
  openChatOrganizationQueue,
  persistChatOrganizationQueue,
  summarizeChatOrganizationQueue,
} from "./chatOrganizationQueue.ts";

const TASKS = [
  { conversation: "conversation-a", project: "Yoga App" },
  { conversation: "conversation-b", project: "Invoices & Purchases" },
] as const;

describe("ChatGPT organization queue", () => {
  it("accepts fixed or randomized operation intervals", () => {
    const fixed = chatOrganizationIntervalFrom("10", 30);
    const range = chatOrganizationIntervalFrom("10-20", 30);

    expect(fixed).toEqual({ minimumSeconds: 10, maximumSeconds: 10 });
    expect(chatOrganizationIntervalLabel(fixed)).toBe("10s");
    expect(range).toEqual({ minimumSeconds: 10, maximumSeconds: 20 });
    expect(chatOrganizationIntervalLabel(range)).toBe("10-20s");
    expect(nextChatOrganizationIntervalSeconds(range, 0)).toBe(10);
    expect(nextChatOrganizationIntervalSeconds(range, 0.999_999)).toBe(20);
    expect(() => chatOrganizationIntervalFrom("20-10", 30)).toThrow("positive ascending range");
  });

  it("loads and normalizes an inline multi-Project plan", async () => {
    const tasks = await loadChatOrganizationTasks(
      JSON.stringify([
        { conversation: " conversation-a ", project: " Yoga App " },
        { conversation: "conversation-b", project: "Invoices & Purchases" },
      ]),
      process.cwd(),
    );

    expect(tasks).toEqual(TASKS);
  });

  it("rejects empty Conversation and Project values", async () => {
    await expect(
      loadChatOrganizationTasks('[{"conversation":" ","project":"Yoga App"}]', process.cwd()),
    ).rejects.toThrow("Conversation id or title");
    await expect(
      loadChatOrganizationTasks('[{"conversation":"conversation-a","project":" "}]', process.cwd()),
    ).rejects.toThrow("Project name");
  });

  it("persists progress, resumes pending work, and records terminal failures", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bridge-organization-queue-"));
    try {
      const opened = await openChatOrganizationQueue({
        repoRoot,
        tasks: TASKS,
        restart: false,
        timestamp: "2026-08-26T10:00:00.000Z",
      });
      let queue = completeChatOrganizationQueueItem({
        queue: opened.queue,
        index: 0,
        status: "moved",
        timestamp: "2026-08-26T10:01:00.000Z",
      });
      queue = failChatOrganizationQueueItem({
        queue,
        index: 1,
        reason: "temporary failure",
        maxAttempts: 2,
        timestamp: "2026-08-26T10:02:00.000Z",
      });
      await persistChatOrganizationQueue(opened.path, queue);

      const resumed = await openChatOrganizationQueue({
        repoRoot,
        tasks: TASKS,
        restart: false,
        timestamp: "2026-08-26T10:03:00.000Z",
      });
      expect(nextChatOrganizationQueueIndex(resumed.queue)).toBe(1);
      const failed = failChatOrganizationQueueItem({
        queue: resumed.queue,
        index: 1,
        reason: "still failing",
        maxAttempts: 2,
        timestamp: "2026-08-26T10:04:00.000Z",
      });

      expect(summarizeChatOrganizationQueue(failed)).toEqual({
        total: 2,
        pending: 0,
        moved: 1,
        alreadyFiled: 0,
        failed: 1,
      });
      expect(nextChatOrganizationQueueIndex(failed)).toBeUndefined();
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("does not consume an attempt while ChatGPT is rate-limited", () => {
    const queue = deferChatOrganizationQueueItem({
      queue: {
        version: 1,
        fingerprint: "test",
        createdAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z",
        items: [
          {
            status: "pending",
            conversation: "conversation-a",
            project: "Yoga App",
            attempts: 1,
          },
        ],
      },
      index: 0,
      reason: "rate limited",
      timestamp: "2026-08-26T10:01:00.000Z",
    });

    expect(queue.items[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastReason: "rate limited",
    });
  });

  it("uses a stable plan-specific path and restarts only when requested", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bridge-organization-restart-"));
    try {
      const path = chatOrganizationQueuePath(repoRoot, TASKS);
      const first = await openChatOrganizationQueue({
        repoRoot,
        tasks: TASKS,
        restart: false,
        timestamp: "2026-08-26T10:00:00.000Z",
      });
      const completed = completeChatOrganizationQueueItem({
        queue: first.queue,
        index: 0,
        status: "already-filed",
        timestamp: "2026-08-26T10:01:00.000Z",
      });
      await persistChatOrganizationQueue(path, completed);

      const restarted = await openChatOrganizationQueue({
        repoRoot,
        tasks: TASKS,
        restart: true,
        timestamp: "2026-08-26T10:02:00.000Z",
      });
      expect(restarted.path).toBe(path);
      expect(summarizeChatOrganizationQueue(restarted.queue).pending).toBe(2);
      expect(restarted.queue.createdAt).toBe("2026-08-26T10:02:00.000Z");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
