import { useEffect } from "react";
import type { AppProps } from "@/terminal/tui/shell/app-types.ts";
import { loadInputSuggestions } from "@/terminal/tui/suggestions/load-suggestions.ts";
import type { ComposerState } from "./use-composer-state.ts";

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

        const isSuggestionsMissing = suggestions === undefined;
        if (isSuggestionsMissing) {
          state.setInputSuggestions(null);
          return;
        }

        state.setInputSuggestions(suggestions);
      } catch {
        const isNotCancelled = !cancelled;
        if (isNotCancelled) state.setInputSuggestions(null);
      }
    };

    void loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [props.config.repoPath, state.allCommands, state.input, state.setInputSuggestions]);
};
