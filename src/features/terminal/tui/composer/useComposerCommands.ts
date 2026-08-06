import { useCallback, useMemo } from "react";
import type { CommandContext } from "@/features/domain";
import { executeCommand } from "../../cliOperations.ts";
import type { AppProps, PromptSendResult } from "../shell/appTypes.ts";
import { projectAwarePrompt } from "../shell/projectAwarePrompt.ts";
import type { ComposerState } from "./useComposerState.ts";

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
  if (options.commandText.startsWith("/")) {
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
  const prompt = await projectAwarePrompt({ input: options.commandText, ctx: options.ctx });
  const promptSendResult = await options.enqueueOrSendPrompt(prompt);
  if (promptSendResult === "queued") return;
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
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  input.state.setStatus(`Error: ${message}`);
  console.error(message);
};
