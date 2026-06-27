import type { Page } from "playwright";
import { readTurnSnapshot, turnSnapshotSettled } from "./turn-snapshot.ts";

/** Context for {@link waitForLastAssistantTextStable}. */
export interface WaitForLastAssistantTextStableContext {
  /** Playwright page handle for the ChatGPT tab. */
  page: Page;
  /** Maximum wait time in milliseconds. */
  timeout: number;
}

/** Wait until assistant text and assets hold still long enough to count as settled. */
export async function waitForLastAssistantTextStable(ctx: WaitForLastAssistantTextStableContext): Promise<void> {
  const startedAt = Date.now();
  let lastSnapshot = await readTurnSnapshot({ page: ctx.page });
  let stableSince = Date.now();
  while (Date.now() - startedAt < ctx.timeout) {
    const snapshot = await readTurnSnapshot({ page: ctx.page });
    if (snapshot.text !== lastSnapshot.text || snapshot.assetCount !== lastSnapshot.assetCount) {
      lastSnapshot = snapshot;
      stableSince = Date.now();
    }
    if (turnSnapshotSettled({ snapshot, stableForMs: Date.now() - stableSince })) return;
    await ctx.page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for ChatGPT response to settle.");
}
