import { startEngine } from "../../bridge/create-engine.factory.ts";
import { getBrowserProvider, normalizeProvider } from "../../providers/create-provider.factory.ts";
import type { AskOptions } from "./ask.types.ts";
import { fail } from "./shared.ts";

/** Ensure the browser is connected and signed in, or exit with guidance. */
export async function assertSignedIn(
  engine: Awaited<ReturnType<typeof startEngine>>,
  browserProvider: ReturnType<typeof getBrowserProvider>,
  provider: ReturnType<typeof normalizeProvider>,
): Promise<void> {
  if (!engine.browser) {
    await engine.shutdown({ closeBrowser: false });
    fail(`Browser not connected. Run \`bridge login --provider ${provider}\` once to sign in.`);
  }
  try {
    await browserProvider.assertSignedIn(engine.browser!.getPage());
  } catch (err) {
    await engine.shutdown({ closeBrowser: false });
    fail(err instanceof Error ? err.message : String(err));
  }
}

/** Write the ask reply as plain text or JSON, or exit on empty reply. */
export function writeAskOutput(
  engine: Awaited<ReturnType<typeof startEngine>>,
  reply: Awaited<ReturnType<typeof engine.ask>>,
  options: AskOptions,
  provider: ReturnType<typeof normalizeProvider>,
  displayName: string,
): void {
  if (!reply) {
    fail(
      `No reply captured — ${displayName} may not be logged in, or the page UI changed. Try \`bridge login --provider ${provider}\`.`,
    );
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      sessionId: engine.getSessionId(),
      model: engine.orchestrator.model,
      reply: reply!.content,
      contextTokens: engine.counter.count,
    })}\n`);
    return;
  }
  process.stdout.write(`${reply!.content}\n`);
}
