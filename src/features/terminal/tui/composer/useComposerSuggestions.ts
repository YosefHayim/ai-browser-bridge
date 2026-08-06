import { useEffect } from "react";
import type { AppProps } from "../shell/appTypes.ts";
import { loadInputSuggestions } from "../suggestions/inputSuggestions.ts";
import type { ComposerState } from "./useComposerState.ts";

export const useComposerSuggestions = (state: ComposerState, props: AppProps) => {
  useEffect(() => {
    let cancelled = false;

    const loadSuggestions = async () => {
      try {
        const suggestions = await loadInputSuggestions(state.input, {
          repoRoot: props.config.repoPath,
          commands: state.allCommands,
        });
        if (cancelled) return;
        if (suggestions === undefined) {
          state.setInputSuggestions(null);
          return;
        }
        state.setInputSuggestions(suggestions);
      } catch {
        if (!cancelled) state.setInputSuggestions(null);
      }
    };

    void loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [props.config.repoPath, state.allCommands, state.input, state.setInputSuggestions]);
};
