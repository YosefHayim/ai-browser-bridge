import { extractFileMentions } from "@/features/store";
import { type MutableRefObject, useMemo, useRef, useState } from "react";
import { getAllCommands, matchCommands } from "../internal/cliRunner.ts";
import type { InputMode } from "./appTypes.ts";
import { PromptHistory } from "./composerHistory.ts";
import type { InputSuggestionGroup } from "./inputSuggestions.ts";

/** Mutable composer refs shared across keyboard and send handlers. */
export type ComposerRefs = {
  suppressNextSubmit: MutableRefObject<boolean>;
  lastEscapeAt: MutableRefObject<number>;
  stopShortcutRunning: MutableRefObject<boolean>;
  history: MutableRefObject<PromptHistory>;
  sendInProgress: MutableRefObject<boolean>;
  queuedPromptRef: MutableRefObject<string[]>;
};

/** Base composer state and derived lists. */
export type ComposerState = {
  input: string;
  setInput: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  mode: InputMode;
  setMode: (value: InputMode) => void;
  selectedIdx: number;
  setSelectedIdx: (value: number | ((index: number) => number)) => void;
  inputSuggestions: InputSuggestionGroup | null;
  setInputSuggestions: (value: InputSuggestionGroup | null) => void;
  queuedPrompt: string | null;
  setQueuedPrompt: (value: string | null) => void;
  forceRender: (value: number | ((current: number) => number)) => void;
  refs: ComposerRefs;
  allCommands: ReturnType<typeof getAllCommands>;
  matches: ReturnType<typeof matchCommands>;
  fileMentions: string[];
};

/**
 * Initializes composer state, refs, and derived command lists.
 *
 * @returns The `useComposerState` result.
 * @example
 * ```ts
 * const result = useComposerState();
 * ```
 */
export const useComposerState = (): ComposerState => {
  const ui = useComposerUiState();
  const refs = useComposerRefs();
  const derived = useComposerDerived(ui.input);
  return { ...ui, refs, ...derived };
};

const useComposerUiState = () => {
  const inputState = useComposerInputFields();
  const panelState = useComposerPanelFields();
  return { ...inputState, ...panelState };
};

const useComposerInputFields = () => {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<InputMode>("typing");
  const [selectedIdx, setSelectedIdx] = useState(0);
  return { input, setInput, mode, setMode, selectedIdx, setSelectedIdx };
};

const useComposerPanelFields = () => {
  const [status, setStatus] = useState("Ready");
  const [inputSuggestions, setInputSuggestions] = useState<InputSuggestionGroup | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  return {
    status,
    setStatus,
    inputSuggestions,
    setInputSuggestions,
    queuedPrompt,
    setQueuedPrompt,
    forceRender,
  };
};

const useComposerDerived = (input: string) => {
  const allCommands = useMemo(() => getAllCommands(), []);
  const matches = useMemo(() => matchCommandInput({ input, allCommands }), [allCommands, input]);
  const fileMentions = useMemo(() => extractFileMentions(input), [input]);
  return { allCommands, matches, fileMentions };
};

const useComposerRefs = (): ComposerRefs => {
  return {
    suppressNextSubmit: useRef(false),
    lastEscapeAt: useRef(0),
    stopShortcutRunning: useRef(false),
    history: useRef(new PromptHistory()),
    sendInProgress: useRef(false),
    queuedPromptRef: useRef<string[]>([]),
  };
};

const matchCommandInput = (options: {
  input: string;
  allCommands: ReturnType<typeof getAllCommands>;
}) => {
  if (!options.input.startsWith("/")) return [];
  const partial = options.input.slice(1).split(" ")[0];
  if (!partial) return options.allCommands;
  return matchCommands(partial);
};
