import { type MutableRefObject, useMemo, useRef, useState } from "react";
import { extractFileMentions } from "@/store/file-mentions.ts";
import { listRegisteredCommands, matchCommands } from "@/terminal/cli-operations.ts";
import type { InputMode } from "@/terminal/tui/shell/app-types.ts";
import type { InputSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";
import { PromptHistory } from "./composer-history.ts";

type ComposerRefs = {
  suppressNextSubmit: MutableRefObject<boolean>;
  lastEscapeAt: MutableRefObject<number>;
  stopShortcutRunning: MutableRefObject<boolean>;
  history: MutableRefObject<PromptHistory>;
  sendInProgress: MutableRefObject<boolean>;
  queuedPromptRef: MutableRefObject<string[]>;
};

export type ComposerState = {
  input: string;
  setInput: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  mode: InputMode;
  setMode: (value: InputMode) => void;
  selectedIndex: number;
  setSelectedIndex: (value: number | ((index: number) => number)) => void;
  inputSuggestions: InputSuggestionGroup | null;
  setInputSuggestions: (value: InputSuggestionGroup | null) => void;
  queuedPrompt: string | null;
  setQueuedPrompt: (value: string | null) => void;
  forceRender: (value: number | ((current: number) => number)) => void;
  refs: ComposerRefs;
  allCommands: ReturnType<typeof listRegisteredCommands>;
  matches: ReturnType<typeof matchCommands>;
  fileMentions: string[];
};

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
  const [selectedIndex, setSelectedIndex] = useState(0);
  return { input, setInput, mode, setMode, selectedIndex, setSelectedIndex };
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
  const allCommands = useMemo(() => listRegisteredCommands(), []);
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
  allCommands: ReturnType<typeof listRegisteredCommands>;
}) => {
  const isNotSlashCommand = !options.input.startsWith("/");
  if (isNotSlashCommand) return [];

  const partial = options.input.slice(1).split(" ")[0];
  const isPartialBlank = partial === undefined || partial === "";
  if (isPartialBlank) return options.allCommands;

  return matchCommands(partial);
};
