import { type MutableRefObject, useMemo, useRef, useState } from "react";
import { extractFileMentions } from "@/store/file-mentions.ts";
import { findCommandsByPartialName, listRegisteredCommands } from "@/terminal/cli-operations.ts";
import type { PromptMode } from "@/terminal/tui/shell/app-types.ts";
import type { PromptSuggestionGroup } from "@/terminal/tui/suggestions/types.ts";
import { createPromptHistory, type PromptHistory } from "./composer-history.ts";

type ComposerRefs = {
  suppressNextSubmit: MutableRefObject<boolean>;
  lastEscapeAt: MutableRefObject<number>;
  stopShortcutRunning: MutableRefObject<boolean>;
  history: MutableRefObject<PromptHistory>;
  sendInProgress: MutableRefObject<boolean>;
  queuedPromptRef: MutableRefObject<string[]>;
};

export type ComposerStatus = {
  input: string;
  setInput: (field: string) => void;
  status: string;
  setStatus: (field: string) => void;
  mode: PromptMode;
  setMode: (field: PromptMode) => void;
  selectedIndex: number;
  setSelectedIndex: (field: number | ((index: number) => number)) => void;
  inputSuggestions: PromptSuggestionGroup | null;
  setInputSuggestions: (field: PromptSuggestionGroup | null) => void;
  queuedPrompt: string | null;
  setQueuedPrompt: (field: string | null) => void;
  forceRender: (field: number | ((current: number) => number)) => void;
  refs: ComposerRefs;
  allCommands: ReturnType<typeof listRegisteredCommands>;
  matches: ReturnType<typeof findCommandsByPartialName>;
  fileMentions: string[];
};

export const useComposerStatus = (): ComposerStatus => {
  const ui = useComposerFields();
  const refs = useComposerRefs();
  const derived = useComposerDerived(ui.input);
  return { ...ui, refs, ...derived };
};

const useComposerFields = () => {
  const promptStatus = useComposerPromptFields();
  const panelStatus = useComposerPanelFields();
  return { ...promptStatus, ...panelStatus };
};

const useComposerPromptFields = () => {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<PromptMode>("typing");
  const [selectedIndex, setSelectedIndex] = useState(0);
  return { input: prompt, setInput: setPrompt, mode, setMode, selectedIndex, setSelectedIndex };
};

const useComposerPanelFields = () => {
  const [status, setStatus] = useState("Ready");
  const [promptSuggestions, setPromptSuggestions] = useState<PromptSuggestionGroup | null>(null);
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  return {
    status,
    setStatus,
    inputSuggestions: promptSuggestions,
    setInputSuggestions: setPromptSuggestions,
    queuedPrompt,
    setQueuedPrompt,
    forceRender,
  };
};

const useComposerDerived = (prompt: string) => {
  const allCommands = useMemo(() => listRegisteredCommands(), []);
  const hits = useMemo(
    () => findCommandsForLine({ input: prompt, allCommands }),
    [allCommands, prompt],
  );
  const fileMentions = useMemo(() => extractFileMentions(prompt), [prompt]);

  return { allCommands, matches: hits, fileMentions };
};

const useComposerRefs = (): ComposerRefs => {
  return {
    suppressNextSubmit: useRef(false),
    lastEscapeAt: useRef(0),
    stopShortcutRunning: useRef(false),
    history: useRef(createPromptHistory()),
    sendInProgress: useRef(false),
    queuedPromptRef: useRef<string[]>([]),
  };
};

const findCommandsForLine = (settings: {
  input: string;
  allCommands: ReturnType<typeof listRegisteredCommands>;
}) => {
  const isNotSlashCommand = !settings.input.startsWith("/");
  if (isNotSlashCommand) return [];

  const partial = settings.input.slice(1).split(" ")[0];

  const isPartialBlank = partial == null || partial === "";
  if (isPartialBlank) return settings.allCommands;

  return findCommandsByPartialName(partial);
};
