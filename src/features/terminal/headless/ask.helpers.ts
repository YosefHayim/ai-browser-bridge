import { resolve } from "node:path";
import { startEngine } from "../../bridge/create-engine.factory.ts";
import { getBrowserProvider, normalizeProvider } from "../../providers/create-provider.factory.ts";
import type { AskOptions } from "./ask.types.ts";
import { abortAndExit, redirectConsoleToStderr, timeoutMsFromSeconds } from "./shared.ts";
import { assertSignedIn, writeAskOutput } from "./ask.output.helpers.ts";

/** Inputs for starting the ask engine. */
interface StartAskEngineInput {
  /** CLI ask options. */
  options: AskOptions;
  /** Normalized provider id. */
  provider: ReturnType<typeof normalizeProvider>;
  /** Whether the provider supports MCP connector tooling. */
  supportsMcpConnector: boolean;
}

/** Run the full headless ask flow and exit. */
export async function runAskFlow(input: { prompt: string; options: AskOptions }): Promise<void> {
  redirectConsoleToStderr();
  const setup = await prepareAskRun(input.options);
  const reply = await runAskTurn({ engine: setup.engine, prompt: input.prompt, options: input.options });
  await finishAskRun({ setup, reply, options: input.options });
}

/** Start engine, register signals, and verify sign-in. */
async function prepareAskRun(options: AskOptions) {
  const providers = resolveAskProviders(options);
  const engine = await startAskEngine({
    options,
    provider: providers.provider,
    supportsMcpConnector: providers.browserProvider.supportsMcpConnector,
  });
  registerAskSignalHandlers(engine);
  await assertSignedIn(engine, providers.browserProvider, providers.provider);
  return { engine, ...providers };
}

/** Resolve normalized provider and browser provider for ask runs. */
function resolveAskProviders(options: AskOptions) {
  const provider = normalizeProvider(options.provider);
  return { provider, browserProvider: getBrowserProvider(provider) };
}

/** Shut down engine, write output, and exit. */
async function finishAskRun(input: {
  setup: Awaited<ReturnType<typeof prepareAskRun>>;
  reply: Awaited<ReturnType<Awaited<ReturnType<typeof startEngine>>["ask"]>>;
  options: AskOptions;
}): Promise<void> {
  await input.setup.engine.shutdown({ closeBrowser: false });
  writeAskOutput(
    input.setup.engine,
    input.reply,
    input.options,
    input.setup.provider,
    input.setup.browserProvider.displayName,
  );
  process.exit(0);
}

/** Start the engine for a headless ask run. */
export async function startAskEngine(input: StartAskEngineInput) {
  return startEngine({
    repoPath: input.options.repo ? resolve(input.options.repo) : undefined,
    provider: input.provider,
    mcpPort: input.options.port ? Number(input.options.port) : undefined,
    withBrowser: true,
    withTools: Boolean(input.options.tools) && input.supportsMcpConnector,
  });
}

/** Register SIGINT/SIGTERM handlers that abort the in-flight turn. */
export function registerAskSignalHandlers(engine: Awaited<ReturnType<typeof startEngine>>): void {
  process.once("SIGINT", () => void abortAndExit(engine, 130, process.exit));
  process.once("SIGTERM", () => void abortAndExit(engine, 143, process.exit));
}

export { assertSignedIn, writeAskOutput } from "./ask.output.helpers.ts";

/** Apply preflight options and send the ask prompt. */
export async function runAskTurn(input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  prompt: string;
  options: AskOptions;
}) {
  await applyAskPreflight({ engine: input.engine, options: input.options });
  return input.engine.ask({ content: input.prompt, timeoutMs: timeoutMsFromSeconds(input.options.timeout) });
}

/** Apply --fresh and --model preflight options before asking. */
async function applyAskPreflight(input: {
  engine: Awaited<ReturnType<typeof startEngine>>;
  options: AskOptions;
}): Promise<void> {
  if (input.options.fresh) await input.engine.orchestrator.newConversation().catch(() => {});
  if (input.options.model) await input.engine.orchestrator.switchModel(input.options.model).catch(() => {});
}
