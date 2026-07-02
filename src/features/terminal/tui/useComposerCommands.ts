import { useCallback, useMemo } from "react";
import type { CommandContext } from "../../domain/types.ts";
import { executeCommand } from "../cliRunner.ts";
import type { PromptSendResult } from "./appTypes.ts";
import type { AppProps } from "./appTypes.ts";
import { projectAwarePrompt } from "./projectAwarePrompt.ts";
import type { ComposerState } from "./useComposerState.ts";

/** Options for slash command execution. */
export type ComposerCommandOptions = {
  /** Composer state container. */
  state: ComposerState;
  /** App props used to build command context. */
  props: AppProps;
  /** Prompt send handler. */
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendResult>;
};

/** Creates command context and runCommand handler. */
export function useComposerCommands(options: ComposerCommandOptions) {
  const ctx = useCommandContext(options.props);
  const runCommand = useRunCommand({ ...options, ctx });
  return runCommand;
}

function useCommandContext(props: AppProps): CommandContext {
  return useMemo(
    () => ({
      config: props.config,
      messages: props.messages,
      sendMessage: props.sendMessage,
      clearMessages: props.clearMessages,
      shutdown: props.shutdown,
      counter: props.counter,
      orchestrator: props.orchestrator,
      permission: props.permission,
      session: props.session,
      statusline: props.statusline,
    }),
    [props],
  );
}

function useRunCommand(options: ComposerCommandOptions & { ctx: CommandContext }) {
  const { state, enqueueOrSendPrompt, ctx } = options;
  return useCallback(
    async (cmd: string) => {
      try {
        await executeCommandOrPrompt({ cmd, ctx, state, enqueueOrSendPrompt });
      } catch (err) {
        reportCommandError({ state, err });
      } finally {
        state.forceRender((value) => value + 1);
      }
    },
    [ctx, enqueueOrSendPrompt, state],
  );
}

async function executeCommandOrPrompt(options: {
  cmd: string;
  ctx: CommandContext;
  state: ComposerState;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendResult>;
}) {
  const handled = await executeCommand(options.cmd, options.ctx);
  if (handled) {
    options.state.setStatus("Ready");
    return;
  }
  if (options.cmd.startsWith("/")) {
    reportUnknownCommand({ state: options.state, cmd: options.cmd });
    return;
  }
  await sendProjectAwarePrompt(options);
}

/** Send a non-command prompt through the project-aware wrapper. */
async function sendProjectAwarePrompt(options: {
  cmd: string;
  ctx: CommandContext;
  state: ComposerState;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendResult>;
}): Promise<void> {
  const prompt = await projectAwarePrompt({ input: options.cmd, ctx: options.ctx });
  const sendResult = await options.enqueueOrSendPrompt(prompt);
  if (sendResult === "queued") return;
  options.state.setStatus("Ready");
}

function reportUnknownCommand(input: { state: ComposerState; cmd: string }) {
  const name = input.cmd.slice(1).split(" ")[0] || "/";
  input.state.setStatus(`Unknown command: /${name}`);
  console.error(`Unknown command: /${name}`);
}

function reportCommandError(input: { state: ComposerState; err: unknown }) {
  const message = input.err instanceof Error ? input.err.message : String(input.err);
  input.state.setStatus(`Error: ${message}`);
  console.error(message);
}
