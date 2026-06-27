import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Message, BridgeConfig, CommandContext, ModelOption, CommandDef } from "../types/types.ts";
import {
  executeCommand,
  matchCommands,
  getAllCommands,
} from "./commands/registry.ts";
import { buildProjectTaskPromptWithInstructions } from "./commands/prompts.ts";
import { ContextCounter } from "../core/context-counter.ts";
import { extractFileMentions } from "../core/file-resolver.ts";
import { loadProjectInstructions } from "../core/project-instructions.ts";
import { isDoubleEscapePress } from "./shortcuts.ts";
import { findReverseHistoryMatch, PromptHistory } from "./composer-history.ts";
import {
  applyInputSuggestion,
  loadInputSuggestions,
  type InputSuggestionGroup,
} from "./input-suggestions.ts";

const ESCAPE_CONTROL = "\u001B";
const ASSIST_PANEL_HEIGHT = 10;
const VISIBLE_SUGGESTION_LIMIT = 6;
type PromptSendResult = "sent" | "queued";
type MessageRoleTheme = {
  color: string;
  backgroundColor: string;
  label: "You" | "ChatGPT";
  prefix: ">" | "<";
};

const MESSAGE_ROLE_THEMES: Record<Message["role"], MessageRoleTheme> = {
  user: {
    color: "white",
    backgroundColor: "blue",
    label: "You",
    prefix: ">",
  },
  assistant: {
    color: "white",
    backgroundColor: "blackBright",
    label: "ChatGPT",
    prefix: "<",
  },
};

export function getMessageRoleTheme(role: Message["role"]): MessageRoleTheme {
  return MESSAGE_ROLE_THEMES[role];
}

interface AppProps {
  config: BridgeConfig;
  sendMessage: (content: string) => Promise<void>;
  clearMessages?: () => void;
  shutdown?: () => Promise<void>;
  messages: Message[];
  counter: ContextCounter;
  orchestrator: {
    listConversations(): Promise<Array<{ id: string; title: string; url: string }>>;
    navigateToConversation(url: string): Promise<void>;
    newConversation(): Promise<void>;
    model: string;
    detectModel(): Promise<string>;
    listModels(): Promise<ModelOption[]>;
    switchModel(query: string): Promise<string>;
    rewindLastPrompt(replacement?: string): Promise<void>;
    stopResponse(): Promise<boolean>;
    attachFiles?(paths: string[]): Promise<void>;
    openConnectorSetup?: CommandContext["orchestrator"]["openConnectorSetup"];
  };
  permissionMode?: string;
  sessionId?: string;
  branch?: string;
  toolCallCount?: number;
  permission?: CommandContext["permission"];
  session?: CommandContext["session"];
  statusline?: CommandContext["statusline"];
}

type InputMode = "typing" | "command-list";

export function BridgeApp({
  config,
  sendMessage,
  clearMessages,
  shutdown,
  messages,
  counter,
  orchestrator,
  permissionMode,
  sessionId,
  branch,
  toolCallCount = 0,
  permission,
  session,
  statusline,
}: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Ready");
  const [mode, setMode] = useState<InputMode>("typing");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [inputSuggestions, setInputSuggestions] = useState<InputSuggestionGroup | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const suppressNextSubmit = useRef(false);
  const lastEscapeAt = useRef(0);
  const stopShortcutRunning = useRef(false);
  const history = useRef(new PromptHistory());
  const sendInProgress = useRef(false);
  const queuedPromptRef = useRef<string | null>(null);

  const allCommands = useMemo(() => getAllCommands(), []);

  /** Commands matching the current / prefix. */
  const matches = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const partial = input.slice(1).split(" ")[0];
    if (!partial) return allCommands;
    return matchCommands(partial);
  }, [input, allCommands]);

  const fileMentions = useMemo(() => extractFileMentions(input), [input]);

  useEffect(() => {
    let cancelled = false;
    loadInputSuggestions(input, {
      repoRoot: config.repoPath,
      commands: allCommands,
    })
      .then((suggestions) => {
        if (!cancelled) setInputSuggestions(suggestions);
      })
      .catch(() => {
        if (!cancelled) setInputSuggestions(null);
      });

    return () => {
      cancelled = true;
    };
  }, [allCommands, config.repoPath, input]);

  const enqueueOrSendPrompt = useCallback(
    async (prompt: string): Promise<PromptSendResult> => {
      if (sendInProgress.current) {
        queuedPromptRef.current = prompt;
        setQueuedPrompt(prompt);
        setStatus("Queued prompt; it will send after the current response starts.");
        return "queued";
      }

      sendInProgress.current = true;
      let nextPrompt: string | null = prompt;

      try {
        while (nextPrompt) {
          const currentPrompt = nextPrompt;
          nextPrompt = null;
          queuedPromptRef.current = null;
          setQueuedPrompt(null);
          setStatus("Sending...");
          await sendMessage(currentPrompt);
          nextPrompt = queuedPromptRef.current;
        }
        setStatus("Ready");
        return "sent";
      } finally {
        sendInProgress.current = false;
      }
    },
    [sendMessage],
  );

  const stopFromShortcut = useCallback(() => {
    if (stopShortcutRunning.current) return;

    stopShortcutRunning.current = true;
    setStatus("Stopping ChatGPT...");

    orchestrator.stopResponse()
      .then((stopped) => {
        setStatus(stopped ? "Stopped active response." : "No active response to stop.");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${message}`);
        console.error(message);
      })
      .finally(() => {
        stopShortcutRunning.current = false;
        forceRender((value) => value + 1);
      });
  }, [orchestrator]);

  const handleEscapePress = useCallback((now = Date.now()) => {
    if (isDoubleEscapePress(lastEscapeAt.current, now)) {
      lastEscapeAt.current = 0;
      setMode("typing");
      stopFromShortcut();
      return;
    }

    lastEscapeAt.current = now;
    if (mode === "command-list") {
      setMode("typing");
      return;
    }

    setStatus("Press Esc again to stop ChatGPT");
  }, [mode, stopFromShortcut]);

  useEffect(() => {
    const handleStdinData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      const escapeCount = text.length - text.replaceAll(ESCAPE_CONTROL, "").length;
      if (escapeCount === 0) return;

      const now = Date.now();
      for (let i = 0; i < escapeCount; i += 1) {
        handleEscapePress(now + i);
      }
    };

    process.stdin.on("data", handleStdinData);
    return () => {
      process.stdin.off("data", handleStdinData);
    };
  }, [handleEscapePress]);

  /** Tab-complete the current input to the selected match. */
  const tabComplete = useCallback(() => {
    if (matches.length === 0) return;
    const cmd = matches[selectedIdx] ?? matches[0];
    setInput(`/${cmd.name} `);
    setMode("typing");
  }, [matches, selectedIdx]);

  /** Handle raw key input for command navigation and confirmation. */
  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      exit();
      return;
    }

    if (key.ctrl && (char === "r" || char === "\u0012")) {
      const match = findReverseHistoryMatch(history.current.entries(), input);
      if (match) {
        setInput(match);
        setStatus(`History match: ${match}`);
      } else {
        setStatus(`No history match for "${input}"`);
      }
      return;
    }

    // Command list navigation
    if (mode === "command-list") {
      const suggestions = inputSuggestions?.suggestions ?? [];
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        const maxIndex = Math.max(0, (suggestions.length || matches.length) - 1);
        setSelectedIdx((i) => Math.min(maxIndex, i + 1));
        return;
      }
      if (key.tab) {
        if (inputSuggestions?.suggestions.length) {
          const suggestionIndex = Math.min(selectedIdx, inputSuggestions.suggestions.length - 1);
          const suggestion = inputSuggestions.suggestions[suggestionIndex] ?? inputSuggestions.suggestions[0];
          const nextInput = applyInputSuggestion(input, inputSuggestions, suggestionIndex);
          setInput(nextInput);
          setMode("typing");
          setStatus(`Completed ${suggestion.label}`);
          return;
        }
        tabComplete();
        return;
      }
      if (key.return && suggestions.length > 0) {
        const suggestion = suggestions[selectedIdx] ?? suggestions[0];
        const fullCmd = suggestion.label;
        suppressNextSubmit.current = true;
        setInput("");
        setMode("typing");
        runCommand(fullCmd);
        return;
      }
      if (key.return && matches.length > 0) {
        const cmd = matches[selectedIdx] ?? matches[0];
        const fullCmd = `/${cmd.name}`;
        suppressNextSubmit.current = true;
        setInput("");
        setMode("typing");
        runCommand(fullCmd);
        return;
      }
    }

    if (mode === "typing") {
      if (key.upArrow) {
        setInput(history.current.previous(input));
        return;
      }
      if (key.downArrow) {
        setInput(history.current.next());
        return;
      }
      if (key.tab) {
        if (inputSuggestions?.suggestions.length) {
          const nextInput = applyInputSuggestion(input, inputSuggestions);
          setInput(nextInput);
          setStatus(`Completed ${inputSuggestions.suggestions[0].label}`);
        }
        return;
      }
    }
  });

  const ctx: CommandContext = useMemo(
    () => ({
      config,
      messages,
      sendMessage,
      clearMessages,
      shutdown,
      counter,
      orchestrator,
      permission,
      session,
      statusline,
    }),
    [config, messages, sendMessage, clearMessages, counter, orchestrator, shutdown, permission, session, statusline],
  );

  const runCommand = useCallback(
    async (cmd: string) => {
      try {
        const handled = await executeCommand(cmd, ctx);
        if (!handled) {
          if (cmd.startsWith("/")) {
            const name = cmd.slice(1).split(" ")[0] || "/";
            setStatus(`Unknown command: /${name}`);
            console.error(`Unknown command: /${name}`);
            return;
          }
          const prompt = await projectAwarePrompt(cmd, ctx);
          const sendResult = await enqueueOrSendPrompt(prompt);
          if (sendResult === "queued") return;
        }
        setStatus("Ready");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${message}`);
        console.error(message);
      } finally {
        forceRender((value) => value + 1);
      }
    },
    [ctx, enqueueOrSendPrompt],
  );

  const handleInputChange = useCallback((value: string) => {
    if (value.includes(ESCAPE_CONTROL)) {
      setInput(value.replaceAll(ESCAPE_CONTROL, ""));
      return;
    }

    lastEscapeAt.current = 0;
    setInput(value);
    // Activate command list mode when typing /
    if (value.startsWith("/")) {
      if (!value.includes(" ")) {
        setMode("command-list");
        setSelectedIdx(0);
      } else {
        setMode("typing");
      }
    } else {
      setMode("typing");
    }
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      if (suppressNextSubmit.current) {
        suppressNextSubmit.current = false;
        return;
      }

      const trimmed = value.trim();
      if (!trimmed) return;

      if (trimmed === "/") {
        setInput("");
        setMode("typing");
        return;
      }

      history.current.add(trimmed);
      setInput("");
      setMode("typing");
      await runCommand(trimmed);
    },
    [runCommand],
  );

  const ctxPct = counter.fraction * 100;
  const ctxColor = ctxPct > 80 ? "red" : ctxPct > 50 ? "yellow" : "green";
  const displayPermissionMode = permission?.getMode() ?? permissionMode ?? config.permissionMode ?? "auto";
  const displayToolCallCount = statusline?.toolCallCount() ?? toolCallCount;
  const displayBranch = statusline?.branch ?? branch;
  const displaySessionId = session?.getId() ?? sessionId;
  const shortStatus = status.length > 14 ? `${status.slice(0, 13)}…` : status;
  const shortModel = counter.modelLabel.length > 10 ? `${counter.modelLabel.slice(0, 9)}…` : counter.modelLabel;
  const shortBranch = displayBranch && displayBranch.length > 8 ? `${displayBranch.slice(0, 7)}…` : displayBranch;

  return (
    <Box flexDirection="column" height="100%">
      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {messages.map((msg) => (
          <MessageRow key={msg.id} message={msg} />
        ))}
      </Box>

      {/* Status bar */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>{shortStatus}</Text>
        <Text> | </Text>
        <Text color={ctxColor}>
          ctx {ctxPct.toFixed(0)}%
        </Text>
        <Text> | </Text>
        <Text color="magenta">{shortModel}</Text>
        <Text> | </Text>
        <Text dimColor>p:{displayPermissionMode}</Text>
        <Text> | </Text>
        <Text dimColor>t:{displayToolCallCount}</Text>
        <Text> | </Text>
        <Text dimColor>{shortBranch ?? "nogit"}</Text>
        <Text> | </Text>
        <Text dimColor>{displaySessionId ? displaySessionId.slice(0, 8) : "nosess"}</Text>
      </Box>

      {/* Input bar */}
      <Box paddingX={1}>
        <Text color="cyan">{">"} </Text>
        <TextInput value={input} onChange={handleInputChange} onSubmit={handleSubmit} />
      </Box>

      <ComposerAssistPanel
        mode={mode}
        inputSuggestions={inputSuggestions}
        matches={matches}
        selectedIdx={selectedIdx}
        fileMentions={fileMentions}
        queuedPrompt={queuedPrompt}
      />
    </Box>
  );
}

function ComposerAssistPanel({
  mode,
  inputSuggestions,
  matches,
  selectedIdx,
  fileMentions,
  queuedPrompt,
}: {
  mode: InputMode;
  inputSuggestions: InputSuggestionGroup | null;
  matches: readonly CommandDef[];
  selectedIdx: number;
  fileMentions: readonly string[];
  queuedPrompt: string | null;
}) {
  const hasCommandSuggestions = mode === "command-list" && Boolean(inputSuggestions?.suggestions.length);
  const hasCommandFallback = mode === "command-list" && !inputSuggestions?.suggestions.length && matches.length > 0;
  const hasTypingSuggestions = mode === "typing" && Boolean(inputSuggestions);
  const showFiles = fileMentions.length > 0 && !inputSuggestions;

  return (
    <Box flexDirection="column" height={ASSIST_PANEL_HEIGHT} paddingX={1}>
      {hasCommandSuggestions && inputSuggestions && (
        <>
          <Text dimColor>{inputSuggestions.title}:</Text>
          {visibleMenuItems(inputSuggestions.suggestions, selectedIdx, VISIBLE_SUGGESTION_LIMIT).map(({ item: suggestion, index }) => (
            <Box key={`${suggestion.kind}:${suggestion.value}`}>
              <Text>
                {index === selectedIdx ? <Text color="cyan" bold>{">"}</Text> : " "}
                {" "}
                <Text color={index === selectedIdx ? "cyan" : "white"} bold={index === selectedIdx}>
                  {suggestion.label.padEnd(16)}
                </Text>
                {suggestion.detail ? <Text dimColor> {suggestion.detail}</Text> : null}
              </Text>
            </Box>
          ))}
          {inputSuggestions.hint && (
            <Text dimColor>  {inputSuggestions.hint}</Text>
          )}
        </>
      )}

      {hasCommandFallback && (
        <>
          <Text dimColor>Commands:</Text>
          {visibleMenuItems(matches, selectedIdx, VISIBLE_SUGGESTION_LIMIT).map(({ item: cmd, index }) => (
            <Box key={cmd.name}>
              <Text>
                {index === selectedIdx ? <Text color="cyan" bold>{">"}</Text> : " "}
                {" /"}
                <Text color={index === selectedIdx ? "cyan" : "white"} bold={index === selectedIdx}>
                  {cmd.name.padEnd(14)}
                </Text>
                <Text dimColor> {cmd.description}</Text>
              </Text>
            </Box>
          ))}
          {matches.length > VISIBLE_SUGGESTION_LIMIT && (
            <Text dimColor>  ... and {matches.length - VISIBLE_SUGGESTION_LIMIT} more</Text>
          )}
        </>
      )}

      {hasTypingSuggestions && inputSuggestions && (
        <>
          <Text dimColor>{inputSuggestions.title}:</Text>
          {inputSuggestions.suggestions.slice(0, VISIBLE_SUGGESTION_LIMIT).map((suggestion, i) => (
            <Text key={`${suggestion.kind}:${suggestion.value}`}>
              {i === 0 ? <Text color="cyan" bold>{">"}</Text> : " "}
              {" "}
              <Text color={i === 0 ? "cyan" : "white"}>{suggestion.label}</Text>
              {suggestion.detail ? <Text dimColor> {suggestion.detail}</Text> : null}
            </Text>
          ))}
          {inputSuggestions.hint && (
            <Text dimColor>  {inputSuggestions.hint}</Text>
          )}
        </>
      )}

      {showFiles && (
        <Text>
          <Text dimColor>Files: </Text>
          <Text color="cyan">{fileMentions.map((file) => `@${file}`).join(" ")}</Text>
        </Text>
      )}

      {queuedPrompt && (
        <Text>
          <Text dimColor>Queued: </Text>
          <Text color="yellow">{queuedPrompt.slice(0, 80)}</Text>
        </Text>
      )}

      <Text dimColor>Ctrl+R history | Up/Down history | Tab suggestion | paste multiline text, Enter sends</Text>
    </Box>
  );
}

function visibleMenuItems<T>(
  items: readonly T[],
  selectedIdx: number,
  limit: number,
): Array<{ item: T; index: number }> {
  const safeSelected = Math.min(Math.max(selectedIdx, 0), Math.max(items.length - 1, 0));
  const start = Math.max(0, Math.min(safeSelected - limit + 1, items.length - limit));
  return items.slice(start, start + limit).map((item, offset) => ({ item, index: start + offset }));
}

async function projectAwarePrompt(input: string, ctx: CommandContext): Promise<string> {
  if (!shouldAutoWrapProjectPrompt(input)) return input;
  const instructions = await loadProjectInstructions(ctx.config.repoPath);
  return buildProjectTaskPromptWithInstructions(input, ctx, instructions.promptText);
}

export function shouldAutoWrapProjectPrompt(input: string): boolean {
  const text = input.toLowerCase();
  if (/@[\w./-]+/.test(input)) return true;

  const hasProjectNoun = /\b(repo|repository|project|codebase|local|file|files|folder|folders|structure|src|test|tests|package|readme)\b/.test(text);
  const hasAction = /\b(check|inspect|read|review|analyze|analyse|find|fix|debug|change|edit|update|add|implement|refactor|optimize|optimise|run|test|verify|qa|explain)\b/.test(text);
  return hasProjectNoun && hasAction;
}

function MessageRow({ message }: { message: Message }) {
  const theme = getMessageRoleTheme(message.role);

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text>
        <Text color={theme.color} backgroundColor={theme.backgroundColor} bold>{theme.prefix} {theme.label}: </Text>
        {" "}
        <Text color={theme.color} backgroundColor={theme.backgroundColor}>{message.content.slice(0, 500)}{message.content.length > 500 ? "..." : ""}</Text>
      </Text>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <Box marginLeft={2}>
          <Text dimColor>
            [tools: {message.toolCalls.map((tc) => tc.name).join(", ")}]
          </Text>
        </Box>
      )}
    </Box>
  );
}
