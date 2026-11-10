import { useCallback, useMemo } from "react";
import type { CommandContext } from "@/domain/command-types.ts";
import { executeCommand } from "@/terminal/cli-operations.ts";
import type { AppProps, PromptSendResult } from "@/terminal/tui/shell/app-types.ts";
import { createProjectAwarePrompt } from "@/terminal/tui/shell/project-aware-prompt.ts";
import type { ComposerState } from "./use-composer-state.ts";

export type ComposerCommandOptions = {
  readonly state: ComposerState;
  readonly props: AppProps;
  readonly enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendResult>;
};

export const useComposerCommands = (options: ComposerCommandOptions) => {
  const ctx = useCommandContext(options.props);
  return useRunCommand({ ...options, ctx });
};

const useCommandContext = (props: AppProps): CommandContext => {
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
};

const useRunCommand = (options: ComposerCommandOptions & { ctx: CommandContext }) => {
  const { state, enqueueOrSendPrompt, ctx } = options;
  return useCallback(
    async (commandText: string) => {
      try {
        await executeCommandOrPrompt({ commandText, ctx, state, enqueueOrSendPrompt });
      } catch (error) {
        reportCommandError({ state, error });
      } finally {
        state.forceRender((value) => value + 1);
      }
    },
    [ctx, enqueueOrSendPrompt, state],
  );
};

const executeCommandOrPrompt = async (options: {
  commandText: string;
  ctx: CommandContext;
  state: ComposerState;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendResult>;
}) => {
  const handled = await executeCommand(options.commandText, options.ctx);
  if (handled) {
    options.state.setStatus("Ready");
    return;
  }

  const isSlashCommandText = options.commandText.startsWith("/");
  if (isSlashCommandText) {
    reportUnknownCommand({ state: options.state, commandText: options.commandText });
    return;
  }

  await sendProjectAwarePrompt(options);
};

const sendProjectAwarePrompt = async (options: {
  commandText: string;
  ctx: CommandContext;
  state: ComposerState;
  enqueueOrSendPrompt: (prompt: string) => Promise<PromptSendResult>;
}): Promise<void> => {
  const prompt = await createProjectAwarePrompt({ input: options.commandText, ctx: options.ctx });

  const promptSendResult = await options.enqueueOrSendPrompt(prompt);
  const isPromptSendQueued = promptSendResult === "queued";
  if (isPromptSendQueued) return;

  options.state.setStatus("Ready");
};

const reportUnknownCommand = (input: { state: ComposerState; commandText: string }) => {
  const nameSegment = input.commandText.slice(1).split(" ")[0];

  let name = nameSegment;
  if (name === undefined || name === "") name = "/";

  input.state.setStatus(`Unknown command: /${name}`);
  console.error(`Unknown command: /${name}`);
};

const reportCommandError = (input: { state: ComposerState; error: unknown }) => {
  const isErrorObject = input.error instanceof Error;
  const message = isErrorObject ? input.error.message : String(input.error);
  input.state.setStatus(`Error: ${message}`);
  console.error(message);
};
