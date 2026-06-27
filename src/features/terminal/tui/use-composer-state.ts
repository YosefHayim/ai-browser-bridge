import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { getAllCommands, matchCommands } from "../commands/registry.ts";
import { extractFileMentions } from "../../store/file-resolver.ts";
import type { InputSuggestionGroup } from "./input-suggestions.ts";
import type { InputMode } from "./app-types.ts";
import { PromptHistory } from "./composer-history.ts";

/** Mutable composer refs shared across keyboard and send handlers. */
export type ComposerRefs = {
  suppressNextSubmit: MutableRefObject<boolean>;
  lastEscapeAt: MutableRefObject<number>;
  stopShortcutRunning: MutableRefObject<boolean>;
  history: MutableRefObject<PromptHistory>;
  sendInProgress: MutableRefObject<boolean>;
  queuedPromptRef: MutableRefObject<string | null>;
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

/** Initializes composer state, refs, and derived command lists. */
export function useComposerState(): ComposerState {
  const ui = useComposerUiState();
  const refs = useComposerRefs();
  const derived = useComposerDerived(ui.input);
  return { ...ui, refs, ...derived };
}

function useComposerUiState() {
  const inputState = useComposerInputFields();
  const panelState = useComposerPanelFields();
  return { ...inputState, ...panelState };
}

function useComposerInputFields() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<InputMode>("typing");
  const [selectedIdx, setSelectedIdx] = useState(0);
  return { input, setInput, mode, setMode, selectedIdx, setSelectedIdx };
}

function useComposerPanelFields() {
  const [status, setStatus] = useState("Ready");
  const [inputSuggestions, setInputSuggestions] = useState<InputSuggestionGroup | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  return { status, setStatus, inputSuggestions, setInputSuggestions, queuedPrompt, setQueuedPrompt, forceRender };
}

function useComposerDerived(input: string) {
  const allCommands = useMemo(() => getAllCommands(), []);
  const matches = useMemo(() => matchCommandInput({ input, allCommands }), [allCommands, input]);
  const fileMentions = useMemo(() => extractFileMentions(input), [input]);
  return { allCommands, matches, fileMentions };
}

function useComposerRefs(): ComposerRefs {
  return {
    suppressNextSubmit: useRef(false),
    lastEscapeAt: useRef(0),
    stopShortcutRunning: useRef(false),
    history: useRef(new PromptHistory()),
    sendInProgress: useRef(false),
    queuedPromptRef: useRef(null),
  };
}

function matchCommandInput(options: { input: string; allCommands: ReturnType<typeof getAllCommands> }) {
  if (!options.input.startsWith("/")) return [];
  const partial = options.input.slice(1).split(" ")[0];
  if (!partial) return options.allCommands;
  return matchCommands(partial);
}
